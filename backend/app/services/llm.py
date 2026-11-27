"""Provider-agnostic LLM wrapper over the OpenAI-compatible Chat Completions API.

Any provider exposing an OpenAI-compatible endpoint (Groq, OpenAI, Together, OpenRouter,
Ollama, vLLM, ...) works by changing ``LLM_BASE_URL`` / ``LLM_MODEL`` / the API key.

* 429 rate limits and transient 5xx/network errors are retried with exponential backoff + jitter,
  honouring ``Retry-After``.
* Reasoning-model tags (``<think>...</think>``) are stripped and ``reasoning_effort`` is
  passed when supported so only the final answer text is returned.
* ``chat_json`` includes local JSON cleanup plus a single LLM JSON-repair retry if parsing fails.
* ``MockLLM`` is an offline stand-in used for tests and for local dev without an API key.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime
from email.utils import parsedate_to_datetime
from functools import lru_cache
from typing import TYPE_CHECKING, Any

import httpx
import openai
from openai import AsyncOpenAI

from ..config import Settings, get_settings
from .service_status import (
    FailureKind,
    ServiceStatusTracker,
    classify_provider_error,
    get_service_status,
    redact_secrets,
)

if TYPE_CHECKING:
    from .stt import SpeechToText

log = logging.getLogger(__name__)

Message = dict[str, str]

LLM_FALLBACK_PREFERENCE: tuple[str, ...] = (
    "openai/gpt-oss-120b",
    "qwen/qwen3.6-27b",
    "openai/gpt-oss-20b",
    "qwen/qwen3-32b",
    "llama-3.1-8b-instant",
)

STT_FALLBACK_PREFERENCE: tuple[str, ...] = (
    "whisper-large-v3-turbo",
    "whisper-large-v3",
)

_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.IGNORECASE | re.DOTALL)
_UNCLOSED_THINK_RE = re.compile(r"^<think\b[^>]*>.*$", re.IGNORECASE | re.DOTALL)
_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")
_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")


class LLMError(RuntimeError):
    """The LLM call failed (after retries) or returned unusable output."""

    def __init__(
        self,
        message: str,
        *,
        failure_kind: FailureKind = "other",
        retry_after_seconds: float | None = None,
        retry_at: datetime | None = None,
    ) -> None:
        super().__init__(message)
        self.failure_kind: FailureKind = failure_kind
        self.retry_after_seconds: float | None = retry_after_seconds
        self.retry_at: datetime | None = retry_at


class LLMRateLimitError(LLMError):
    """Still rate limited (HTTP 429) after all retries."""

    def __init__(
        self,
        message: str,
        *,
        failure_kind: FailureKind = "rate_limited_temporary",
        retry_after_seconds: float | None = None,
        retry_at: datetime | None = None,
    ) -> None:
        super().__init__(
            message,
            failure_kind=failure_kind,
            retry_after_seconds=retry_after_seconds,
            retry_at=retry_at,
        )


def strip_reasoning(text: str) -> str:
    """Remove inline reasoning tags so callers only receive the final answer."""
    cleaned = _THINK_BLOCK_RE.sub("", text)
    cleaned = _UNCLOSED_THINK_RE.sub("", cleaned)
    return cleaned.strip()


class LLMClient(ABC):
    provider: str = "base"
    model: str = ""

    @abstractmethod
    async def chat(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.7,
        max_tokens: int = 300,
        json_mode: bool = False,
        purpose: str = "generic",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Return the assistant message text.

        ``purpose`` and ``metadata`` are for logging/tracing (and drive ``MockLLM``);
        real providers do not send them.
        """

    async def chat_json(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.3,
        max_tokens: int = 512,
        purpose: str = "generic",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        text = await self.chat(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
            purpose=purpose,
            metadata=metadata,
        )
        try:
            return parse_json_object(text)
        except LLMError as first_err:
            log.warning(
                "Malformed JSON from LLM (%s); attempting one repair pass: %s",
                purpose,
                first_err,
            )
            repair_messages: list[Message] = [
                {
                    "role": "system",
                    "content": "Return ONLY a single valid JSON object. No prose, no markdown fences.",
                },
                {
                    "role": "user",
                    "content": f"Convert or repair this into a valid JSON object:\n{text}",
                },
            ]
            repaired = await self.chat(
                repair_messages,
                temperature=0.0,
                max_tokens=max_tokens,
                json_mode=True,
                purpose=f"{purpose}_json_repair",
                metadata=metadata,
            )
            return parse_json_object(repaired)

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None


class OpenAICompatibleLLM(LLMClient):
    def __init__(
        self,
        *,
        provider: str,
        api_key: str,
        base_url: str,
        model: str,
        reasoning_effort: str | None = "low",
        timeout: float = 30.0,
        max_retries: int = 1,
        backoff_base: float = 1.0,
        backoff_max: float = 30.0,
        max_concurrency: int = 4,
        http_client: httpx.AsyncClient | None = None,
        status_tracker: ServiceStatusTracker | None = None,
    ) -> None:
        self.provider = provider
        self.model = model
        self._reasoning_effort = reasoning_effort.strip().lower() if reasoning_effort else None
        self._max_retries = max(0, max_retries)
        self._backoff_base = backoff_base
        self._backoff_max = backoff_max
        self._semaphore = asyncio.Semaphore(max(1, max_concurrency))
        self._status = status_tracker or get_service_status()
        # max_retries=0: retries are handled here so we control backoff and logging.
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=0,
            http_client=http_client,
        )

    async def chat(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.7,
        max_tokens: int = 300,
        json_mode: bool = False,
        purpose: str = "generic",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        allowed, is_probe = self._status.try_begin_llm_call()
        if not allowed:
            raise LLMRateLimitError(
                "AI service usage limit reached.",
                failure_kind="quota_exhausted",
                retry_at=self._status.llm_retry_at,
            )

        use_json = json_mode
        use_reasoning = bool(self._reasoning_effort)
        attempt = 0
        try:
            while True:
                started = time.monotonic()
                try:
                    extra: dict[str, Any] = {}
                    if use_json:
                        extra["response_format"] = {"type": "json_object"}
                    if use_reasoning and self._reasoning_effort:
                        extra["reasoning_effort"] = self._reasoning_effort
                    async with self._semaphore:
                        resp = await self._client.chat.completions.create(
                            model=self.model,
                            messages=messages,  # type: ignore[arg-type]
                            temperature=temperature,
                            max_tokens=max_tokens,
                            **extra,
                        )
                    raw_content = (resp.choices[0].message.content or "") if resp.choices else ""
                    content = strip_reasoning(raw_content)
                    if not content:
                        raise LLMError(
                            f"LLM returned an empty completion ({purpose})",
                            failure_kind="other",
                        )
                    self._status.record_llm_success()
                    log.debug("LLM %s ok in %.2fs", purpose, time.monotonic() - started)
                    return content
                except openai.RateLimitError as exc:
                    classified = classify_provider_error(exc)
                    safe_detail = redact_secrets(str(exc))
                    if classified.kind == "quota_exhausted":
                        if is_probe or attempt >= self._max_retries:
                            log.error(
                                "LLM 429 quota exhausted (%s, model=%s, retry_after=%s): %s",
                                purpose,
                                self.model,
                                classified.retry_after_seconds,
                                safe_detail,
                            )
                            self._status.record_llm_quota_exhausted(classified.retry_at)
                            raise LLMRateLimitError(
                                "AI service usage limit reached.",
                                failure_kind="quota_exhausted",
                                retry_after_seconds=classified.retry_after_seconds,
                                retry_at=classified.retry_at,
                            ) from exc
                        delay = min(self._backoff(attempt), 2.0)
                        log.warning(
                            "LLM 429 quota-type rate limit (%s, model=%s, retry_after=%s). Retry %d/%d in %.1fs: %s",
                            purpose,
                            self.model,
                            classified.retry_after_seconds,
                            attempt + 1,
                            self._max_retries,
                            delay,
                            safe_detail,
                        )
                    else:
                        if attempt >= self._max_retries:
                            log.error(
                                "LLM 429 temporary rate limit exhausted (%s, model=%s, retry_after=%s): %s",
                                purpose,
                                self.model,
                                classified.retry_after_seconds,
                                safe_detail,
                            )
                            self._status.record_llm_degraded(classified.retry_at)
                            raise LLMRateLimitError(
                                "AI service is temporarily rate limited.",
                                failure_kind="rate_limited_temporary",
                                retry_after_seconds=classified.retry_after_seconds,
                                retry_at=classified.retry_at,
                            ) from exc
                        if classified.retry_after_seconds is not None:
                            delay = min(10.0, max(0.0, classified.retry_after_seconds))
                        else:
                            delay = min(10.0, self._backoff(attempt))
                        log.warning(
                            "LLM 429 temporary rate limit (%s, model=%s). Retry %d/%d in %.1fs: %s",
                            purpose,
                            self.model,
                            attempt + 1,
                            self._max_retries,
                            delay,
                            safe_detail,
                        )
                except (openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError) as exc:
                    safe_detail = redact_secrets(str(exc))
                    if attempt >= self._max_retries:
                        log.error(
                            "LLM provider unavailable after retries (%s, model=%s, %s): %s",
                            purpose,
                            self.model,
                            type(exc).__name__,
                            safe_detail,
                        )
                        self._status.record_llm_degraded()
                        raise LLMError(
                            "AI service is temporarily unavailable.",
                            failure_kind="provider_unavailable",
                        ) from exc
                    delay = self._backoff(attempt)
                    log.warning(
                        "LLM transient error (%s, model=%s, %s). Retry %d/%d in %.1fs: %s",
                        purpose,
                        self.model,
                        type(exc).__name__,
                        attempt + 1,
                        self._max_retries,
                        delay,
                        safe_detail,
                    )
                except openai.BadRequestError as exc:
                    safe_detail = redact_secrets(str(exc))
                    msg_lower = str(exc).lower()
                    if use_reasoning and "reasoning" in msg_lower:
                        log.info(
                            "LLM rejected reasoning_effort (%s, model=%s); retrying without it",
                            purpose,
                            self.model,
                        )
                        use_reasoning = False
                        continue
                    if use_json:
                        log.info("LLM rejected JSON mode (%s, model=%s); retrying without it", purpose, self.model)
                        use_json = False
                        continue
                    if use_reasoning:
                        log.info("LLM bad request (%s, model=%s); retrying without reasoning_effort", purpose, self.model)
                        use_reasoning = False
                        continue
                    log.error("LLM bad request (%s, model=%s): %s", purpose, self.model, safe_detail)
                    raise LLMError("AI service request failed.", failure_kind="other") from exc
                except openai.APIStatusError as exc:
                    classified = classify_provider_error(exc)
                    safe_detail = redact_secrets(str(exc))
                    log.error(
                        "LLM API error %s (%s, model=%s, kind=%s): %s",
                        exc.status_code,
                        purpose,
                        self.model,
                        classified.kind,
                        safe_detail,
                    )
                    if classified.kind == "provider_unavailable":
                        self._status.record_llm_degraded()
                    raise LLMError(
                        "AI service request failed.",
                        failure_kind=classified.kind,
                    ) from exc
                attempt += 1
                await asyncio.sleep(delay)
        finally:
            if is_probe:
                self._status.finish_llm_probe()

    def _backoff(self, attempt: int) -> float:
        cap = min(self._backoff_max, self._backoff_base * (2**attempt))
        return cap / 2 + random.uniform(0, cap / 2)

    @staticmethod
    def _retry_after(exc: openai.APIStatusError) -> float | None:
        headers = getattr(getattr(exc, "response", None), "headers", None) or {}
        ms = headers.get("retry-after-ms")
        if ms:
            try:
                return min(60.0, max(0.0, float(ms) / 1000))
            except ValueError:
                pass
        value = headers.get("retry-after")
        if not value:
            return None
        try:
            seconds = float(value)
        except ValueError:
            try:
                seconds = parsedate_to_datetime(value).timestamp() - time.time()
            except (TypeError, ValueError):
                return None
        # small jitter so concurrent callers don't retry in lock-step
        return min(60.0, max(0.0, seconds)) + random.uniform(0, 0.25)

    async def aclose(self) -> None:
        await self._client.close()


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object from model output, tolerating reasoning tags, fences, prose and trailing commas."""
    s = strip_reasoning(text)
    s = _FENCE_RE.sub("", s).strip()
    candidates = [s]
    start, end = s.find("{"), s.rfind("}")
    if start != -1 and end > start:
        candidates.append(s[start : end + 1])

    last_err: Exception | None = None
    for candidate in candidates:
        for attempt_str in (candidate, _TRAILING_COMMA_RE.sub(r"\1", candidate)):
            try:
                obj = json.loads(attempt_str)
            except json.JSONDecodeError as exc:
                last_err = exc
                continue
            if not isinstance(obj, dict):
                raise LLMError("expected a JSON object from the LLM")
            return obj

    if start == -1 or end <= start:
        raise LLMError(f"no JSON object in LLM response: {text[:200]!r}")
    raise LLMError(f"invalid JSON in LLM response: {text[:200]!r}") from last_err


# --------------------------------------------------------------------------------------
# Startup model verification & fallback
# --------------------------------------------------------------------------------------


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        clean = item.strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


async def verify_provider_models(
    settings: Settings,
    llm: LLMClient,
    stt: SpeechToText | None = None,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Check ``GET {base_url}/models`` on startup and apply fallback models if configured ones are missing."""
    if llm.provider == "mock" or not settings.api_key:
        msg = f"Startup model check: skipped (LLM provider={llm.provider}, model={llm.model})"
        print(msg, flush=True)
        log.info(msg)
        return {"status": "skipped", "llm_model": llm.model, "stt_model": getattr(stt, "model", None)}

    models_url = f"{settings.llm_base_url.rstrip('/')}/models"
    headers = {"Authorization": f"Bearer {settings.api_key}"}

    try:
        if http_client is not None:
            resp = await http_client.get(models_url, headers=headers, timeout=10.0)
        else:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(models_url, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        msg = f"FAIL: Startup model check could not query {models_url}: {exc}"
        print(msg, flush=True)
        log.error(msg, exc_info=True)
        return {"status": "fail", "error": str(exc), "llm_model": llm.model, "stt_model": getattr(stt, "model", None)}

    available = {
        str(item["id"])
        for item in payload.get("data", [])
        if isinstance(item, dict) and item.get("id")
    }

    # 1. Verify LLM model
    llm_ok = False
    if llm.model in available:
        llm_ok = True
        msg = f"OK: LLM model '{llm.model}' is available at {models_url}."
        print(msg, flush=True)
        log.info(msg)
    else:
        fallbacks = _dedupe([settings.llm_fallback_model, *LLM_FALLBACK_PREFERENCE])
        chosen = next((m for m in fallbacks if m in available and m != llm.model), None)
        if chosen:
            warn = (
                f"WARN: Configured LLM model '{llm.model}' not found in /models; "
                f"falling back to '{chosen}'."
            )
            print(warn, flush=True)
            log.warning(warn)
            llm.model = chosen
            llm_ok = True
        else:
            fail = (
                f"FAIL: Configured LLM model '{llm.model}' not found in /models "
                f"and no fallback from {fallbacks} is available."
            )
            print(fail, flush=True)
            log.error(fail)

    # 2. Verify STT Whisper model (if an API-backed Whisper model is configured)
    stt_model = getattr(stt, "model", None)
    stt_ok = True
    if stt is not None and stt_model:
        if stt_model in available:
            msg = f"OK: STT model '{stt_model}' is available at {models_url}."
            print(msg, flush=True)
            log.info(msg)
        else:
            stt_fallbacks = _dedupe([settings.stt_fallback_model, *STT_FALLBACK_PREFERENCE])
            chosen_stt = next((m for m in stt_fallbacks if m in available and m != stt_model), None)
            if chosen_stt:
                warn = (
                    f"WARN: Configured STT model '{stt_model}' not found in /models; "
                    f"falling back to '{chosen_stt}'."
                )
                print(warn, flush=True)
                log.warning(warn)
                setattr(stt, "model", chosen_stt)
            else:
                stt_ok = False
                fail = (
                    f"FAIL: Configured STT model '{stt_model}' not found in /models "
                    f"and no fallback from {stt_fallbacks} is available."
                )
                print(fail, flush=True)
                log.error(fail)

    overall = "ok" if (llm_ok and stt_ok) else "fail"
    return {
        "status": overall,
        "llm_model": llm.model,
        "stt_model": getattr(stt, "model", None),
        "available_count": len(available),
    }


# --------------------------------------------------------------------------------------
# Offline mock
# --------------------------------------------------------------------------------------

_MOCK_OPENERS: dict[str, list[str]] = {
    "aggressive_debater": ["Let me be blunt.", "I strongly disagree with where this is going."],
    "calm_analyst": ["If we step back for a moment,", "Let's split this into two parts."],
    "data_driven": ["The numbers tell a clear story.", "Look at the evidence here."],
    "empathetic": ["I hear the concerns raised so far.", "We should remember the people affected."],
    "devils_advocate": ["Let me argue the opposite for a second.", "What if the consensus here is wrong?"],
    "visionary": ["Think ten years ahead.", "There's a huge opportunity we're missing."],
    "pragmatist": ["Ideas are cheap; execution matters.", "Let's talk about what is actually feasible."],
    "storyteller": ["My cousin faced exactly this last year.", "Picture a small-town student for a moment."],
    "consensus_builder": ["We actually agree on more than it seems.", "Let me pull the threads together."],
    "questioner": ["Here's the question nobody has asked:", "Are we sure about our core assumption?"],
}

_MOCK_BODIES = [
    "On {topic}, the real issue is incentives, not intentions. {other} raised a fair point, "
    "but without accountability any policy will fail in implementation.",
    "Regarding {topic}, we keep debating extremes. A phased approach with clear checkpoints "
    "lets us capture the benefits while limiting the risks {other} mentioned.",
    "Surveys suggest roughly six in ten young professionals feel directly affected by {topic}. "
    "That makes this a mainstream concern, not a niche debate.",
    "Building on what {other} said, {topic} looks very different in a metro city compared to a "
    "village. One-size-fits-all solutions will leave people behind.",
    "Everyone assumes {topic} is about technology, but it is really about trust. If people don't "
    "trust the system, even the best design gets rejected.",
    "Short-term costs dominate this discussion of {topic}, yet the long-term gains in productivity "
    "and inclusion could outweigh them if we invest in skills first.",
]


class MockLLM(LLMClient):
    """Deterministic-enough offline LLM. Responds according to ``purpose``."""

    provider = "mock"
    model = "mock-gd"

    def __init__(
        self,
        latency: tuple[float, float] = (0.15, 0.5),
        seed: int | None = None,
        status_tracker: ServiceStatusTracker | None = None,
    ) -> None:
        self._latency = latency
        self._rng = random.Random(seed)
        self._status = status_tracker or get_service_status()

    async def chat(
        self,
        messages: list[Message],
        *,
        temperature: float = 0.7,
        max_tokens: int = 300,
        json_mode: bool = False,
        purpose: str = "generic",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        if self._status.is_simulated_llm_exhausted():
            raise LLMRateLimitError(
                "AI service usage limit reached.",
                failure_kind="quota_exhausted",
                retry_at=self._status.llm_retry_at,
            )
        await asyncio.sleep(self._rng.uniform(*self._latency))
        meta = metadata or {}
        if purpose == "ai_turn":
            return self._speech(meta)
        if purpose == "score":
            return json.dumps(self._score())
        if purpose == "report":
            return json.dumps(self._report())
        return "OK"

    def _speech(self, meta: dict[str, Any]) -> str:
        openers = _MOCK_OPENERS.get(meta.get("persona_key", ""), ["I'd like to add a point."])
        others = [o for o in meta.get("others", []) if o != meta.get("name")] or ["the previous speaker"]
        other = meta.get("last_speaker") or self._rng.choice(others)
        if other == meta.get("name"):
            other = self._rng.choice(others)
        topic = str(meta.get("topic", "this topic")).rstrip("?.!").lower()
        body = self._rng.choice(_MOCK_BODIES).format(topic=f"'{topic}'", other=other)
        return f"{self._rng.choice(openers)} {body}"

    def _score(self) -> dict[str, Any]:
        r = self._rng
        return {
            "relevance": r.randint(5, 9),
            "clarity": r.randint(5, 9),
            "content": r.randint(4, 9),
            "teamwork": r.randint(4, 9),
            "comment": r.choice(
                [
                    "Clear stance; back it with one concrete example next time.",
                    "Good build-on to the previous speaker, slightly repetitive.",
                    "Relevant point, but the structure could be tighter.",
                    "Strong evidence; acknowledge counterpoints to sound more balanced.",
                ]
            ),
        }

    def _report(self) -> dict[str, Any]:
        return {
            "strengths": ["Took a clear position early", "Referred to other speakers' points"],
            "improvements": ["Support claims with specific data", "Summarise the discussion before concluding"],
            "summary": "A confident contributor who can add more depth with evidence.",
        }


def build_llm(settings: Settings) -> LLMClient:
    provider = settings.llm_provider.strip().lower()
    if provider == "mock":
        return MockLLM()
    if not settings.api_key:
        log.warning(
            "No API key for LLM provider %r (set GROQ_API_KEY or LLM_API_KEY in backend/.env). "
            "Falling back to the offline MockLLM.",
            provider,
        )
        return MockLLM()
    return OpenAICompatibleLLM(
        provider=provider,
        api_key=settings.api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        reasoning_effort=settings.llm_reasoning_effort,
        timeout=settings.llm_timeout_seconds,
        max_retries=settings.llm_max_retries,
        backoff_base=settings.llm_backoff_base_seconds,
        backoff_max=settings.llm_backoff_max_seconds,
        max_concurrency=settings.llm_max_concurrency,
    )


@lru_cache
def get_llm() -> LLMClient:
    return build_llm(get_settings())
