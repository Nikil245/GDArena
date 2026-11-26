"""AI participant behaviour: generating spoken points and deciding when to raise a hand."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .llm import LLMClient, LLMError, Message, strip_reasoning
from .personas import Persona
from .tts import (
    ALLOWED_VOCAL_DIRECTIONS,
    prepare_text_for_tts,
    strip_vocal_directions,
)

MAX_WORDS = 60
HISTORY_TURNS = 8

_VOCAL_TAG_RE = re.compile(r"\[([^\[\]]{1,40})\]")
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class GeneratedTurn:
    text: str  # clean spoken text shown in transcript and scored (zero [tags])
    tts_text: str  # text sent to TTS (optional single supported [tag] + spoken normalization)


def build_ai_turn_messages(
    *,
    name: str,
    persona: Persona,
    topic: str,
    participants: list[str],
    history: list[tuple[str, str]],
) -> list[Message]:
    supported_dirs = persona.vocal_directions or ("thoughtful", "serious")
    dir_examples = ", ".join(f"[{d}]" for d in supported_dirs)

    system = (
        f"You are {name}, speaking aloud in a live group discussion (GD) for interview and "
        f"placement practice.\n"
        f"Your persona: {persona.label}. {persona.style}\n\n"
        "Speaking rules (strict):\n"
        "- Write natural SPOKEN English, NOT an essay. Output ONLY what you say aloud.\n"
        "- Target 40 to 60 words (hard limit: 60 words). Keep sentences short and conversational "
        "(around 12 to 18 words each) and use natural contractions like it's, don't, we've, that's.\n"
        "- When others have spoken, start with a natural conversational reaction addressing them "
        "by name (for example: \"Fair point, Rohan, but...\", \"I see it differently.\", "
        "\"Right, and on top of that...\").\n"
        "- Add a fresh angle; never repeat what was just said.\n"
        "- STRICTLY NO markdown, bullets, parentheses, em dashes, hyphen-heavy compounds, emojis, "
        "or symbols like %, $, &, or /.\n"
        "- Write numbers and units as people speak them (say \"seventy-one percent\", "
        "\"about two percent of the budget\", \"ten lakh\"), never \"71 %\" or \"2 %\".\n"
        "- Cite at most one simple figure per turn, hedged naturally; never invent fake studies or sources.\n"
        f"- Occasionally (not every turn), you may put AT MOST ONE vocal direction tag at the start of a "
        f"sentence choosing ONLY from {dir_examples}. Omit tags when plain delivery fits best.\n"
        "- Never mention you are an AI or describe your persona."
    )
    others = ", ".join(p for p in participants if p != name) or "none"
    if history:
        lines = "\n".join(f"{speaker}: {text}" for speaker, text in history[-HISTORY_TURNS:])
        situation = f"Discussion so far (most recent last):\n{lines}\n\nIt is now your turn, {name}."
    else:
        situation = (
            "No one has spoken yet. Open the discussion in plain spoken English: frame the topic "
            "and take a clear stance."
        )
    user = (
        f'GD topic: "{topic}"\n'
        f"Other participants: {others}\n\n"
        f"{situation}\nSpeak naturally now (40 to {MAX_WORDS} words)."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def generate_ai_turn(
    llm: LLMClient,
    *,
    name: str,
    persona: Persona,
    topic: str,
    participants: list[str],
    history: list[tuple[str, str]],
) -> GeneratedTurn:
    messages = build_ai_turn_messages(
        name=name, persona=persona, topic=topic, participants=participants, history=history
    )
    raw = await llm.chat(
        messages,
        temperature=persona.temperature,
        max_tokens=512,
        purpose="ai_turn",
        metadata={
            "persona_key": persona.key,
            "name": name,
            "topic": topic,
            "others": [p for p in participants if p != name],
            "last_speaker": history[-1][0] if history else None,
        },
    )
    turn = clean_turn_texts(raw, name=name, max_words=MAX_WORDS)
    if not turn.text:
        raise LLMError("AI produced an empty turn")
    return turn


async def generate_ai_point(
    llm: LLMClient,
    *,
    name: str,
    persona: Persona,
    topic: str,
    participants: list[str],
    history: list[tuple[str, str]],
) -> str:
    return (
        await generate_ai_turn(
            llm,
            name=name,
            persona=persona,
            topic=topic,
            participants=participants,
            history=history,
        )
    ).text


def clean_turn_texts(text: str, *, name: str, max_words: int = MAX_WORDS) -> GeneratedTurn:
    """Clean LLM output into transcript-safe ``text`` and Orpheus-ready ``tts_text``."""
    t = strip_reasoning(text)
    t = re.sub(rf"^\W*{re.escape(name)}\W*:\s*", "", t, flags=re.IGNORECASE)  # "Arjun: ..."
    t = re.sub(r"[*#`~]+", "", t)
    t = t.replace("—", ", ").replace("–", ", ")
    t = re.sub(r"\([^)]*\)", "", t)
    t = re.sub(r"\s+", " ", t).strip().strip("\"'“”‘’").strip()

    # Preserve at most ONE supported [tag] placed at the start of a sentence for Orpheus TTS.
    kept_tag = False
    sentences = [s.strip() for s in _SENTENCE_BOUNDARY_RE.split(t) if s.strip()]
    normalized_sentences: list[str] = []
    for sent in sentences:
        leading = _VOCAL_TAG_RE.match(sent)
        leading_tag = ""
        if leading:
            candidate = " ".join(leading.group(1).strip().lower().split())
            rest = sent[leading.end() :].strip()
            if candidate in ALLOWED_VOCAL_DIRECTIONS and not kept_tag and rest:
                leading_tag = f"[{candidate}]"
                kept_tag = True
            sent = rest
        # Strip any mid-sentence or extra bracket tags everywhere.
        sent = _VOCAL_TAG_RE.sub(" ", sent)
        sent = re.sub(r"\s+", " ", sent).strip()
        if not sent:
            continue
        normalized_sentences.append(f"{leading_tag} {sent}".strip() if leading_tag else sent)

    tts_candidate = " ".join(normalized_sentences)
    plain_candidate = strip_vocal_directions(tts_candidate)

    plain_trunc = truncate_words(plain_candidate, max_words)
    kept_words = len(plain_trunc.split())
    if kept_words <= 0:
        return GeneratedTurn(text="", tts_text="")

    # Rebuild tts_text covering the exact same words so transcript and audio match.
    tts_tokens = tts_candidate.split()
    out_tokens: list[str] = []
    word_count = 0
    for tok in tts_tokens:
        if _VOCAL_TAG_RE.fullmatch(tok):
            if word_count < kept_words:
                out_tokens.append(tok)
            continue
        if word_count < kept_words:
            out_tokens.append(tok)
            word_count += 1
        if word_count >= kept_words:
            break

    raw_tts_trimmed = " ".join(out_tokens)
    if plain_trunc.endswith("…") and not raw_tts_trimmed.endswith((".", "?", "!", "…")):
        raw_tts_trimmed = raw_tts_trimmed.rstrip(",;:-–—") + "."

    tts_ready = prepare_text_for_tts(raw_tts_trimmed, allow_vocal_directions=True)
    return GeneratedTurn(text=plain_trunc, tts_text=tts_ready or plain_trunc)


def clean_speech(text: str, *, name: str, max_words: int = MAX_WORDS) -> str:
    return clean_turn_texts(text, name=name, max_words=max_words).text


def truncate_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    cut = " ".join(words[:max_words])
    # Prefer ending on a sentence boundary when that keeps most of the content.
    boundary = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    if cut[-1:] in ".?!":
        return cut
    if boundary >= len(cut) * 0.5:
        return cut[: boundary + 1]
    return cut.rstrip(",;:-–—") + "…"


def is_mentioned(name: str, text: str) -> bool:
    first = name.split()[0]
    return bool(re.search(rf"\b{re.escape(first)}\b", text, flags=re.IGNORECASE))


def hand_raise_probability(persona: Persona, *, mentioned: bool, multiplier: float = 1.0) -> float:
    """Per-second probability that an idle AI raises its hand."""
    p = persona.eagerness * multiplier
    if mentioned:  # someone just addressed this AI by name -> likely to respond
        p *= 3
    return max(0.0, min(p, 0.9))
