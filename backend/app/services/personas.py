"""AI participant personas.

The first five are the core personas from the spec and are always used first; the
sixth (Kavya) completes the 6 Groq Orpheus English voices, and the remaining four
guarantee every AI in a 10-seat room has a distinct personality and Edge fallback voice.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    key: str
    label: str
    name: str  # default display name
    description: str  # public, shown in the UI
    style: str  # prompt directive
    eagerness: float  # base probability per second of raising a hand
    temperature: float
    voice: str  # Edge TTS Neural voice ShortName (neutral/default fallback)
    rate: str = "+0%"  # Edge TTS speaking rate adjustment
    groq_voice: str | None = None  # Groq Orpheus voice (autumn, diana, hannah, austin, daniel, troy)
    indian_voice: str = "en-IN-NeerjaNeural"  # Edge en-IN voice when TTS_ACCENT_PREFERENCE=indian
    indian_rate: str = "+0%"
    vocal_directions: tuple[str, ...] = ()

    def public(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "voice": self.voice,
            "rate": self.rate,
            "groq_voice": self.groq_voice,
            "indian_voice": self.indian_voice,
        }


CORE_PERSONAS: tuple[Persona, ...] = (
    Persona(
        key="aggressive_debater",
        label="Aggressive Debater",
        name="Arjun",
        description="Assertive; takes strong stances and challenges weak arguments head-on.",
        style=(
            "You are blunt, assertive, and quick to push back. Challenge weak claims directly "
            "and state your view clearly without hedging. Attack ideas, never people."
        ),
        eagerness=0.22,
        temperature=0.9,
        voice="en-IN-PrabhatNeural",
        rate="+8%",
        groq_voice="troy",
        indian_voice="en-IN-PrabhatNeural",
        indian_rate="+8%",
        vocal_directions=("serious", "dramatic"),
    ),
    Persona(
        key="calm_analyst",
        label="Calm Analyst",
        name="Meera",
        description="Measured and structured; breaks the problem into parts and weighs both sides.",
        style=(
            "You are calm, measured, and steady. Separate noise from substance, weigh both sides "
            "plainly, and help the group see the main trade-off."
        ),
        eagerness=0.12,
        temperature=0.6,
        voice="en-IN-NeerjaNeural",
        rate="-5%",
        groq_voice="diana",
        indian_voice="en-IN-NeerjaNeural",
        indian_rate="-5%",
        vocal_directions=("thoughtful", "professionally"),
    ),
    Persona(
        key="data_driven",
        label="Data-Driven Thinker",
        name="Vikram",
        description="Backs points with numbers, studies and real-world examples.",
        style=(
            "You ground your point in practical reality: mention at most one plausible figure or "
            "everyday benchmark, keeping numbers realistic and hedged like 'roughly' or 'around'."
        ),
        eagerness=0.15,
        temperature=0.6,
        voice="en-GB-RyanNeural",
        rate="+0%",
        groq_voice="daniel",
        indian_voice="en-IN-PrabhatNeural",
        indian_rate="-4%",
        vocal_directions=("professionally", "serious"),
    ),
    Persona(
        key="empathetic",
        label="Empathetic Listener",
        name="Ananya",
        description="Focuses on human impact and inclusion; builds on others' ideas.",
        style=(
            "You are warm and focus on real people affected by decisions. Acknowledge someone's "
            "point by name before adding your human-centered angle."
        ),
        eagerness=0.12,
        temperature=0.8,
        voice="en-US-JennyNeural",
        rate="-3%",
        groq_voice="hannah",
        indian_voice="en-IN-NeerjaExpressiveNeural",
        indian_rate="-2%",
        vocal_directions=("cheerful", "thoughtful"),
    ),
    Persona(
        key="devils_advocate",
        label="Devil's Advocate",
        name="Rohan",
        description="Deliberately argues against the dominant view to stress-test it.",
        style=(
            "You deliberately question whichever view the group agrees with too quickly. Raise "
            "an overlooked downside or edge case cleanly and constructively."
        ),
        eagerness=0.17,
        temperature=0.9,
        voice="en-US-GuyNeural",
        rate="+5%",
        groq_voice="austin",
        indian_voice="en-IN-PrabhatNeural",
        indian_rate="+4%",
        vocal_directions=("serious", "sarcastic"),
    ),
)

EXTRA_PERSONAS: tuple[Persona, ...] = (
    Persona(
        key="visionary",
        label="Optimistic Visionary",
        name="Kavya",
        description="Big-picture and future-focused; highlights opportunities.",
        style="You are upbeat and forward-looking. Highlight the long-term opportunity and urge bold thinking.",
        eagerness=0.13,
        temperature=0.9,
        voice="en-GB-SoniaNeural",
        rate="+5%",
        groq_voice="autumn",
        indian_voice="en-IN-NeerjaExpressiveNeural",
        indian_rate="+5%",
        vocal_directions=("cheerful", "excited"),
    ),
    Persona(
        key="pragmatist",
        label="Pragmatic Realist",
        name="Sameer",
        description="Cares about implementation, cost and feasibility.",
        style="You are down-to-earth and practical. Focus on cost, execution hurdles, and what works on day one.",
        eagerness=0.13,
        temperature=0.6,
        voice="en-AU-WilliamNeural",
        rate="+0%",
        groq_voice=None,
        indian_voice="en-IN-PrabhatNeural",
        indian_rate="-2%",
        vocal_directions=("professionally",),
    ),
    Persona(
        key="storyteller",
        label="Storyteller",
        name="Ishita",
        description="Makes points through short anecdotes and relatable examples.",
        style="You open with a tiny, relatable everyday snapshot and turn it into one sharp takeaway.",
        eagerness=0.11,
        temperature=0.9,
        voice="en-AU-NatashaNeural",
        rate="-4%",
        groq_voice=None,
        indian_voice="en-IN-NeerjaExpressiveNeural",
        indian_rate="-4%",
        vocal_directions=("cheerful", "thoughtful"),
    ),
    Persona(
        key="consensus_builder",
        label="Consensus Builder",
        name="Dev",
        description="Summarises, finds common ground and moves the group forward.",
        style=(
            "You connect two opposing points cleanly, highlight shared goals, and help the group "
            "move toward a balanced stance."
        ),
        eagerness=0.10,
        temperature=0.6,
        voice="en-CA-LiamNeural",
        rate="-2%",
        groq_voice=None,
        indian_voice="en-IN-PrabhatNeural",
        indian_rate="-6%",
        vocal_directions=("thoughtful",),
    ),
    Persona(
        key="questioner",
        label="Sharp Questioner",
        name="Nisha",
        description="Asks probing questions that expose hidden assumptions.",
        style="You ask one crisp question that exposes a blind spot, then share your own quick answer.",
        eagerness=0.14,
        temperature=0.8,
        voice="en-US-AriaNeural",
        rate="+4%",
        groq_voice=None,
        indian_voice="en-IN-NeerjaNeural",
        indian_rate="+4%",
        vocal_directions=("thoughtful", "serious"),
    ),
)

ALL_PERSONAS: dict[str, Persona] = {p.key: p for p in CORE_PERSONAS + EXTRA_PERSONAS}


def get_persona(key: str | None) -> Persona | None:
    return ALL_PERSONAS.get(key) if key else None


def find_persona(identifier: str | None) -> Persona | None:
    """Resolve a persona by key or case-insensitive display name."""
    if not identifier:
        return None
    clean = identifier.strip().lower()
    if clean in ALL_PERSONAS:
        return ALL_PERSONAS[clean]
    return next((p for p in ALL_PERSONAS.values() if p.name.lower() == clean), None)


def assign_personas(
    count: int, taken_names: set[str], rng: random.Random | None = None
) -> list[tuple[Persona, str]]:
    """Pick ``count`` distinct personas (core first, then 6th Orpheus voice, then Edge extras)."""
    rng = rng or random.Random()
    core = list(CORE_PERSONAS)
    rng.shuffle(core)

    sixth_orpheus = [p for p in EXTRA_PERSONAS if p.groq_voice]
    remaining_extras = [p for p in EXTRA_PERSONAS if not p.groq_voice]
    rng.shuffle(sixth_orpheus)
    rng.shuffle(remaining_extras)

    pool = core + sixth_orpheus + remaining_extras
    if count > len(pool):
        raise ValueError(f"at most {len(pool)} AI participants are supported")

    taken = {n.lower() for n in taken_names}
    result: list[tuple[Persona, str]] = []
    for persona in pool[:count]:
        name = persona.name
        if name.lower() in taken:
            name = f"{persona.name} (AI)"
            i = 2
            while name.lower() in taken:
                name = f"{persona.name} (AI {i})"
                i += 1
        taken.add(name.lower())
        result.append((persona, name))
    return result
