"""In-memory provider health/quota tracking, error classification, and retry-time parsing.

Never exposes API keys, organization IDs, or raw upstream error text to clients.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import logging
import math
import re
import time
from typing import Any, Literal

import httpx
import openai

from ..config import Settings, get_settings
from ..timeutil import iso, utcnow

log = logging.getLogger(__name__)

FailureKind = Literal[
    "rate_limited_temporary",
    "quota_exhausted",
    "provider_unavailable",
    "other",
]
ServiceHealth = Literal["ok", "degraded", "exhausted"]
ServiceName = Literal["llm", "stt"]

# Generic user-facing messages (never include raw provider errors or org IDs).
LLM_EXHAUSTED_MESSAGE = (
    "AI services have reached their usage limit. AI participants are paused."
)
LLM_RECOVERED_MESSAGE = "AI participants are back."
STT_RATE_LIMITED_MESSAGE = (
    "Speech recognition is busy right now. Please try again in a moment."
)

# Conservative cooldown before probing again when a quota 429 did not specify a retry time.
DEFAULT_UNKNOWN_QUOTA_COOLDOWN_SECONDS = 300.0
QUOTA_RETRY_THRESHOLD_SECONDS = 60.0
SIM_EXHAUSTED_RETRY_SECONDS = 300.0
SIM_RECOVER_SECONDS = 60.0

_QUOTA_HINTS = (
    "tokens per day",
    "requests per day",
    "(tpd)",
    "(rpd)",
    " tpd",
    " rpd",
    "daily limit",
    "daily quota",
    "quota exceeded",
    "exceeded your current quota",
    "insufficient_quota",
    "per day",
)

# Matches compact durations like "2m2.25s", "1h3m", "45s", "500ms", "1d2h3m4s"
_COMPACT_DURATION_RE = re.compile(
    r"(?:(?:try\s+again\s+in|retry\s+(?:after|in)|wait)\s+)"
    r"(?P<expr>(?:\d+(?:\.\d+)?\s*(?:ms|d|h|m|s)(?![a-zA-Z])\s*)+)",
    re.IGNORECASE,
)
_COMPACT_PART_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)", re.IGNORECASE)

# Matches prose durations like "try again in 2 minutes 30 seconds", "try again in 1 hour"
_PROSE_DURATION_RE = re.compile(
    r"(?:(?:try\s+again\s+in|retry\s+(?:after|in)|wait)\s+)"
    r"(?P<expr>(?:\d+(?:\.\d+)?\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|milliseconds?)(?:[\s,]+(?:and\s+)?)?)+)",
    re.IGNORECASE,
)
_PROSE_PART_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)",
    re.IGNORECASE,
)

# Secret / org-ID redaction patterns for server-side logs.
_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bgsk_[A-Za-z0-9_-]{8,}\b"), "[redacted-key]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"), "[redacted-key]"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._-]{8,}\b"), "Bearer [redacted-key]"),
    (re.compile(r"\borg_[A-Za-z0-9_-]+\b"), "[redacted-org]"),
    (re.compile(r"(?i)\b(organization|org)\s+([\"']?)org_[A-Za-z0-9_-]+\2"), r"\1 [redacted-org]"),
)


def redact_secrets(text: str) -> str:
    """Strip API keys, bearer tokens, and organization IDs from text before logging."""
    cleaned = text
    for pattern, repl in _SECRET_PATTERNS:
        cleaned = pattern.sub(repl, cleaned)
    return cleaned


def _unit_seconds(unit: str) -> float:
    u = unit.lower()
    if u in ("ms", "millisecond", "milliseconds"):
        return 0.001
    if u in ("s", "sec", "secs", "second", "seconds"):
        return 1.0
    if u in ("m", "min", "mins", "minute", "minutes"):
        return 60.0
    if u in ("h", "hr", "hrs", "hour", "hours"):
        return 3600.0
    if u in ("d", "day", "days"):
        return 86400.0
    return 0.0


def parse_retry_after_seconds(
    message: str | None = None,
    headers: Any | None = None,
    *,
    now_ts: float | None = None,
) -> float | None:
    """Parse a retry delay (in seconds) from a provider error message or HTTP headers.

    Supports Groq message formats such as ``"Please try again in 2m2.25s"``,
    ``"Please try again in 1h3m"``, ``"Please try again in 45s"``,
    ``"Please try again in 500ms"``, prose units, and HTTP ``Retry-After`` headers.
    Returns ``None`` if no valid duration can be extracted.
    """
    if message:
        m = _COMPACT_DURATION_RE.search(message)
        if m:
            parts = _COMPACT_PART_RE.findall(m.group("expr"))
            if parts:
                total = sum(float(val) * _unit_seconds(unit) for val, unit in parts)
                if math.isfinite(total) and total >= 0:
                    return round(total, 3)

        m_prose = _PROSE_DURATION_RE.search(message)
        if m_prose:
            parts = _PROSE_PART_RE.findall(m_prose.group("expr"))
            if parts:
                total = sum(float(val) * _unit_seconds(unit) for val, unit in parts)
                if math.isfinite(total) and total >= 0:
                    return round(total, 3)

    if headers:
        getter = headers.get if hasattr(headers, "get") else None
        if getter is not None:
            ms_val = getter("retry-after-ms") or getter("Retry-After-Ms")
            if ms_val is not None:
                try:
                    seconds = float(ms_val) / 1000.0
                    if math.isfinite(seconds) and seconds >= 0:
                        return round(seconds, 3)
                except (TypeError, ValueError):
                    pass

            ra_val = getter("retry-after") or getter("Retry-After")
            if ra_val is not None:
                raw = str(ra_val).strip()
                if raw:
                    try:
                        seconds = float(raw)
                        if math.isfinite(seconds) and seconds >= 0:
                            return round(seconds, 3)
                    except ValueError:
                        try:
                            dt = parsedate_to_datetime(raw)
                            if dt.tzinfo is None:
                                dt = dt.replace(tzinfo=timezone.utc)
                            base_ts = time.time() if now_ts is None else now_ts
                            seconds = max(0.0, dt.timestamp() - base_ts)
                            if math.isfinite(seconds):
                                return round(seconds, 3)
                        except (TypeError, ValueError):
                            pass

    return None


@dataclass(frozen=True)
class ClassifiedError:
    kind: FailureKind
    retry_after_seconds: float | None
    retry_at: datetime | None


def _extract_error_text_and_headers(exc: BaseException) -> tuple[str, Any | None, int | None]:
    status_code = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) if response is not None else None
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)

    pieces: list[str] = [str(exc)]
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err_obj = body.get("error")
        if isinstance(err_obj, dict):
            for k in ("message", "type", "code"):
                v = err_obj.get(k)
                if v:
                    pieces.append(str(v))
        elif isinstance(err_obj, str):
            pieces.append(err_obj)
    return " ".join(pieces), headers, status_code


def classify_provider_error(
    exc: BaseException,
    *,
    now: datetime | None = None,
) -> ClassifiedError:
    """Classify an LLM/STT provider exception into one of the four failure kinds."""
    current = now or utcnow()
    text, headers, status_code = _extract_error_text_and_headers(exc)
    lower = text.lower()

    is_429 = isinstance(exc, openai.RateLimitError) or status_code == 429
    if is_429:
        retry_after = parse_retry_after_seconds(text, headers, now_ts=current.timestamp())
        retry_at = (
            current + timedelta(seconds=retry_after)
            if retry_after is not None
            else None
        )
        has_quota_hint = any(hint in lower for hint in _QUOTA_HINTS)
        if has_quota_hint or (
            retry_after is not None and retry_after > QUOTA_RETRY_THRESHOLD_SECONDS
        ):
            return ClassifiedError(
                kind="quota_exhausted",
                retry_after_seconds=retry_after,
                retry_at=retry_at,
            )
        return ClassifiedError(
            kind="rate_limited_temporary",
            retry_after_seconds=retry_after,
            retry_at=retry_at,
        )

    if isinstance(
        exc,
        (
            openai.APITimeoutError,
            openai.APIConnectionError,
            openai.InternalServerError,
            httpx.TimeoutException,
            httpx.TransportError,
            TimeoutError,
        ),
    ) or (isinstance(status_code, int) and status_code >= 500):
        return ClassifiedError(
            kind="provider_unavailable",
            retry_after_seconds=None,
            retry_at=None,
        )

    return ClassifiedError(kind="other", retry_after_seconds=None, retry_at=None)


@dataclass(frozen=True)
class ServiceStatusEvent:
    service: ServiceName
    state: ServiceHealth
    retry_at: datetime | None
    message: str

    def public(self) -> dict[str, Any]:
        return {
            "service": self.service,
            "state": self.state,
            "retry_at": iso(self.retry_at),
            "message": self.message,
        }


StatusListener = Callable[[ServiceStatusEvent], None]


class ServiceStatusTracker:
    """Tracks in-memory health/quota state for LLM and STT services."""

    def __init__(
        self,
        *,
        now_fn: Callable[[], datetime] | None = None,
        unknown_quota_cooldown_seconds: float = DEFAULT_UNKNOWN_QUOTA_COOLDOWN_SECONDS,
    ) -> None:
        self._now = now_fn or utcnow
        self._unknown_quota_cooldown = unknown_quota_cooldown_seconds

        self.llm_status: ServiceHealth = "ok"
        self.stt_status: ServiceHealth = "ok"
        self.llm_retry_at: datetime | None = None
        self.stt_retry_at: datetime | None = None
        self.last_changed: datetime = self._now()

        # Probe & cooldown guards so exhausted services never spin in tight retry loops.
        self._llm_next_probe_at: datetime | None = None
        self._llm_probe_pending: bool = False
        self._llm_probe_in_flight: bool = False

        # Test simulation state (controlled by SIMULATE_LLM_EXHAUSTED).
        self._sim_mode: Literal["off", "exhausted", "recover"] = "off"
        self._sim_recover_seconds: float = SIM_RECOVER_SECONDS
        self._sim_recover_started_at: datetime | None = None
        self._sim_recovered: bool = False

        self._listeners: set[StatusListener] = set()

    # ------------------------------------------------------------------
    # Subscription
    # ------------------------------------------------------------------

    def subscribe(self, listener: StatusListener) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _notify(self, event: ServiceStatusEvent) -> None:
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception:
                log.exception("Service status listener failed")

    # ------------------------------------------------------------------
    # Simulation switch
    # ------------------------------------------------------------------

    def configure_simulation(
        self,
        settings: Settings,
        *,
        recover_seconds: float = SIM_RECOVER_SECONDS,
        start_immediately: bool = False,
    ) -> str:
        """Apply ``SIMULATE_LLM_EXHAUSTED`` (ignored in production unless explicitly allowed)."""
        raw_mode = settings.simulate_llm_exhausted.strip().lower()
        is_prod = settings.environment.strip().lower() in ("production", "prod")
        if is_prod and raw_mode not in ("", "off", "0", "false") and not settings.allow_simulate_in_production:
            log.warning(
                "SIMULATE_LLM_EXHAUSTED=%r ignored because ENVIRONMENT=%r "
                "(set ALLOW_SIMULATE_IN_PRODUCTION=true to override explicitly).",
                settings.simulate_llm_exhausted,
                settings.environment,
            )
            raw_mode = "off"

        self._sim_recover_seconds = max(0.01, recover_seconds)
        self._sim_recovered = False
        self._sim_recover_started_at = None

        if raw_mode in ("exhausted", "true", "1", "on", "5m"):
            self._sim_mode = "exhausted"
            now = self._now()
            self.llm_status = "exhausted"
            self.llm_retry_at = now + timedelta(seconds=SIM_EXHAUSTED_RETRY_SECONDS)
            self._llm_next_probe_at = self.llm_retry_at
            self.last_changed = now
            log.warning("SIMULATE_LLM_EXHAUSTED=exhausted active (retry_at +5m)")
        elif raw_mode in ("recover", "recover_60s", "60s"):
            self._sim_mode = "recover"
            now = self._now()
            self.llm_status = "exhausted"
            self._sim_recover_started_at = now if start_immediately else None
            self.llm_retry_at = now + timedelta(seconds=self._sim_recover_seconds)
            self._llm_next_probe_at = self.llm_retry_at
            self.last_changed = now
            log.warning(
                "SIMULATE_LLM_EXHAUSTED=recover active (will recover %.0fs after room start)",
                self._sim_recover_seconds,
            )
        else:
            self._sim_mode = "off"

        return self._sim_mode

    def notify_room_started(self) -> None:
        """Anchor the 60s recovery clock when a room starts in ``recover`` simulation mode."""
        if self._sim_mode == "recover" and not self._sim_recovered and self._sim_recover_started_at is None:
            now = self._now()
            self._sim_recover_started_at = now
            self.llm_retry_at = now + timedelta(seconds=self._sim_recover_seconds)
            self._llm_next_probe_at = self.llm_retry_at
            self.last_changed = now

    @property
    def simulation_mode(self) -> str:
        return self._sim_mode

    def is_simulated_llm_exhausted(self) -> bool:
        self.check_recovery()
        return self._sim_mode == "exhausted" or (
            self._sim_mode == "recover" and not self._sim_recovered
        )

    # ------------------------------------------------------------------
    # State checks & recovery
    # ------------------------------------------------------------------

    def check_recovery(self) -> None:
        """Advance time-based recovery (both simulated 60s recovery and real ``retry_at`` expiry)."""
        now = self._now()

        if self._sim_mode == "exhausted":
            if self.llm_retry_at is None or now >= self.llm_retry_at:
                self.llm_retry_at = now + timedelta(seconds=SIM_EXHAUSTED_RETRY_SECONDS)
                self._llm_next_probe_at = self.llm_retry_at
            self.llm_status = "exhausted"
            return

        if self._sim_mode == "recover":
            if self._sim_recovered:
                return
            if self._sim_recover_started_at is None:
                # Room has not started yet; keep showing ~60s estimate on /status.
                self.llm_status = "exhausted"
                self.llm_retry_at = now + timedelta(seconds=self._sim_recover_seconds)
                self._llm_next_probe_at = self.llm_retry_at
                return
            target = self._sim_recover_started_at + timedelta(seconds=self._sim_recover_seconds)
            if now >= target:
                self._sim_recovered = True
                self.record_llm_success()
            else:
                self.llm_status = "exhausted"
                self.llm_retry_at = target
                self._llm_next_probe_at = target
            return

        # Real mode: once retry_at passes, mark ok and arm a single-probe gate.
        if self.llm_status == "exhausted":
            if self.llm_retry_at is not None and now >= self.llm_retry_at:
                self.llm_status = "ok"
                self.llm_retry_at = None
                self._llm_next_probe_at = None
                self._llm_probe_pending = True
                self._llm_probe_in_flight = False
                self.last_changed = now
                self._notify(
                    ServiceStatusEvent(
                        service="llm",
                        state="ok",
                        retry_at=None,
                        message=LLM_RECOVERED_MESSAGE,
                    )
                )
            elif (
                self.llm_retry_at is None
                and self._llm_next_probe_at is not None
                and now >= self._llm_next_probe_at
            ):
                self._llm_probe_pending = True

        # STT auto-recovery once stt_retry_at passes
        if self.stt_status != "ok" and self.stt_retry_at is not None and now >= self.stt_retry_at:
            self.stt_status = "ok"
            self.stt_retry_at = None
            self.last_changed = now

    def is_llm_exhausted(self) -> bool:
        self.check_recovery()
        return self.llm_status == "exhausted"

    def try_begin_llm_call(self) -> tuple[bool, bool]:
        """Check whether an LLM call may proceed right now.

        Returns ``(allowed, is_probe)``:
        - When simulated exhausted: ``(False, False)``.
        - When exhausted before ``retry_at``/cooldown: ``(False, False)``.
        - When a single probe call is due (after ``retry_at`` or unknown-retry cooldown):
          allows exactly ONE caller (``(True, True)``) and rejects concurrent callers
          until that probe completes.
        - Otherwise: ``(True, False)``.
        """
        self.check_recovery()
        if self.is_simulated_llm_exhausted():
            return (False, False)
        if self.llm_status == "exhausted":
            if self._llm_probe_pending and not self._llm_probe_in_flight:
                self._llm_probe_in_flight = True
                return (True, True)
            return (False, False)
        if self._llm_probe_pending:
            if self._llm_probe_in_flight:
                return (False, False)
            self._llm_probe_in_flight = True
            return (True, True)
        return (True, False)

    def finish_llm_probe(self) -> None:
        self._llm_probe_in_flight = False

    # ------------------------------------------------------------------
    # State mutations
    # ------------------------------------------------------------------

    def record_llm_success(self) -> None:
        prev = self.llm_status
        now = self._now()
        self.llm_status = "ok"
        self.llm_retry_at = None
        self._llm_next_probe_at = None
        self._llm_probe_pending = False
        self._llm_probe_in_flight = False
        if prev != "ok":
            self.last_changed = now
        if prev == "exhausted":
            self._notify(
                ServiceStatusEvent(
                    service="llm",
                    state="ok",
                    retry_at=None,
                    message=LLM_RECOVERED_MESSAGE,
                )
            )

    def record_llm_degraded(self, retry_at: datetime | None = None) -> None:
        if self.llm_status == "exhausted":
            return
        now = self._now()
        self.llm_status = "degraded"
        self._llm_probe_in_flight = False
        if retry_at is not None:
            self.llm_retry_at = retry_at
        self.last_changed = now

    def record_llm_quota_exhausted(self, retry_at: datetime | None = None) -> None:
        prev = self.llm_status
        prev_retry = self.llm_retry_at
        now = self._now()
        self.llm_status = "exhausted"
        self.llm_retry_at = retry_at
        self._llm_probe_pending = False
        self._llm_probe_in_flight = False
        self._llm_next_probe_at = (
            retry_at
            if retry_at is not None
            else now + timedelta(seconds=self._unknown_quota_cooldown)
        )
        self.last_changed = now
        if prev != "exhausted" or prev_retry != retry_at:
            self._notify(
                ServiceStatusEvent(
                    service="llm",
                    state="exhausted",
                    retry_at=retry_at,
                    message=LLM_EXHAUSTED_MESSAGE,
                )
            )

    def record_stt_success(self) -> None:
        if self.stt_status != "ok" or self.stt_retry_at is not None:
            self.stt_status = "ok"
            self.stt_retry_at = None
            self.last_changed = self._now()

    def record_stt_degraded(self, retry_at: datetime | None = None) -> None:
        if self.stt_status == "exhausted":
            return
        self.stt_status = "degraded"
        if retry_at is not None:
            self.stt_retry_at = retry_at
        self.last_changed = self._now()

    def record_stt_quota_exhausted(self, retry_at: datetime | None = None) -> None:
        self.stt_status = "exhausted"
        self.stt_retry_at = retry_at
        self.last_changed = self._now()

    # ------------------------------------------------------------------
    # Public views (zero secrets)
    # ------------------------------------------------------------------

    @property
    def retry_at(self) -> datetime | None:
        self.check_recovery()
        if self.llm_status != "ok" and self.llm_retry_at is not None:
            return self.llm_retry_at
        if self.stt_status != "ok" and self.stt_retry_at is not None:
            return self.stt_retry_at
        return None

    def public_status(self) -> dict[str, Any]:
        """Response payload for ``GET /status`` (strictly no secrets or raw errors)."""
        self.check_recovery()
        return {
            "llm": self.llm_status,
            "stt": self.stt_status,
            "retry_at": iso(self.retry_at),
        }

    def llm_event_payload(self, *, continue_without_ai: bool = False) -> dict[str, Any]:
        self.check_recovery()
        msg = (
            LLM_EXHAUSTED_MESSAGE
            if self.llm_status == "exhausted"
            else (LLM_RECOVERED_MESSAGE if self.llm_status == "ok" else "AI services are experiencing temporary delays.")
        )
        return {
            "service": "llm",
            "state": self.llm_status,
            "retry_at": iso(self.llm_retry_at),
            "message": msg,
            "continue_without_ai": continue_without_ai,
        }

    def reset(self) -> None:
        """Reset tracker state to healthy (primarily for test isolation)."""
        self.llm_status = "ok"
        self.stt_status = "ok"
        self.llm_retry_at = None
        self.stt_retry_at = None
        self._llm_next_probe_at = None
        self._llm_probe_pending = False
        self._llm_probe_in_flight = False
        self._sim_mode = "off"
        self._sim_recover_started_at = None
        self._sim_recovered = False
        self.last_changed = self._now()


_default_status = ServiceStatusTracker()


def get_service_status() -> ServiceStatusTracker:
    return _default_status

