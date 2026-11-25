"""AI participant behaviour: generating a spoken point and deciding when to raise a hand."""

from __future__ import annotations

import re

from .llm import LLMClient, LLMError, Message
from .personas import Persona

MAX_WORDS = 60
HISTORY_TURNS = 8


def build_ai_turn_messages(
    *,
    name: str,
    persona: Persona,
    topic: str,
    participants: list[str],
    history: list[tuple[str, str]],
) -> list[Message]:
    system = (
        f"You are {name}, a participant in a live group discussion (GD) used for placement and "
        f"interview practice.\n"
        f"Your persona: {persona.label}. {persona.style}\n\n"
        "Rules:\n"
        "- Speak in first person, as if talking aloud to the group. Output ONLY your spoken words.\n"
        f"- At most {MAX_WORDS} words: one or two sharp points, not a speech.\n"
        "- Respond to the flow: build on, challenge or connect what others just said, and refer to "
        "them by name when natural.\n"
        "- Add something new. Never repeat a point already made.\n"
        "- No greetings, no lists, no markdown, no hashtags, no emojis, no stage directions.\n"
        "- Never mention that you are an AI or describe your persona."
    )
    others = ", ".join(p for p in participants if p != name) or "none"
    if history:
        lines = "\n".join(f"{speaker}: {text}" for speaker, text in history[-HISTORY_TURNS:])
        situation = f"Discussion so far (most recent last):\n{lines}\n\nIt is now your turn, {name}."
    else:
        situation = (
            "No one has spoken yet. Open the discussion: frame the topic in one line and take a clear stance."
        )
    user = (
        f'GD topic: "{topic}"\n'
        f"Other participants: {others}\n\n"
        f"{situation}\nSpeak now (max {MAX_WORDS} words)."
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def generate_ai_point(
    llm: LLMClient,
    *,
    name: str,
    persona: Persona,
    topic: str,
    participants: list[str],
    history: list[tuple[str, str]],
) -> str:
    messages = build_ai_turn_messages(
        name=name, persona=persona, topic=topic, participants=participants, history=history
    )
    raw = await llm.chat(
        messages,
        temperature=persona.temperature,
        max_tokens=160,
        purpose="ai_turn",
        metadata={
            "persona_key": persona.key,
            "name": name,
            "topic": topic,
            "others": [p for p in participants if p != name],
            "last_speaker": history[-1][0] if history else None,
        },
    )
    text = clean_speech(raw, name=name, max_words=MAX_WORDS)
    if not text:
        raise LLMError("AI produced an empty turn")
    return text


def clean_speech(text: str, *, name: str, max_words: int = MAX_WORDS) -> str:
    t = text.strip()
    t = re.sub(rf"^\W*{re.escape(name)}\W*:\s*", "", t, flags=re.IGNORECASE)  # "Arjun: ..."
    t = re.sub(r"\([^)]*\)|\[[^\]]*\]", "", t) if t.startswith(("(", "[")) else t  # leading stage directions
    t = re.sub(r"[*#`]+", "", t)
    t = re.sub(r"\s+", " ", t).strip().strip("\"'“”‘’").strip()
    return truncate_words(t, max_words)


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

