"""Per-turn LLM scoring, leaderboard maths and the final report feedback."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from statistics import mean
from typing import Any, Iterable, Protocol

from .llm import LLMClient, LLMError, Message

log = logging.getLogger(__name__)

CRITERIA: tuple[str, ...] = ("relevance", "clarity", "content", "teamwork")
CONTEXT_TURNS = 6


@dataclass
class TurnScore:
    relevance: int
    clarity: int
    content: int
    teamwork: int
    comment: str

    @property
    def scores(self) -> dict[str, int]:
        return {c: getattr(self, c) for c in CRITERIA}

    @property
    def turn_score(self) -> float:
        """Mean of the four criteria (0-10)."""
        return round(mean(self.scores.values()), 2)


SCORING_SYSTEM = (
    "You are an experienced, fair group-discussion (GD) assessor for campus placements.\n"
    "Evaluate ONLY the latest turn by the named speaker; use the earlier discussion as context.\n"
    "Score each criterion as an integer from 0 to 10:\n"
    "- relevance: on-topic and responsive to the flow of the discussion.\n"
    "- clarity: clear, structured, concise and easy to follow.\n"
    "- content: substance - reasoning, facts, examples, originality.\n"
    "- teamwork: engages constructively with others' points, builds or bridges, respectful when disagreeing.\n"
    "Calibration: 5 = average, 7 = good, 9-10 = exceptional. Off-topic, empty or rude turns score low; "
    "very short turns cannot score high on content.\n"
    'Respond with JSON only: {"relevance": int, "clarity": int, "content": int, "teamwork": int, '
    '"comment": "one line, max 20 words, addressed to the speaker as you"}'
)


async def score_turn(
    llm: LLMClient,
    *,
    topic: str,
    speaker: str,
    text: str,
    context: list[tuple[str, str]],
) -> TurnScore:
    earlier = "\n".join(f"{s}: {t}" for s, t in context[-CONTEXT_TURNS:]) or "(this is the opening turn)"
    messages: list[Message] = [
        {"role": "system", "content": SCORING_SYSTEM},
        {
            "role": "user",
            "content": (
                f'GD topic: "{topic}"\n\nEarlier discussion:\n{earlier}\n\n'
                f'Latest turn by {speaker}:\n"{text}"\n\nScore the latest turn.'
            ),
        },
    ]
    data = await llm.chat_json(messages, temperature=0.2, max_tokens=200, purpose="score", metadata={"speaker": speaker})
    if not any(c in data for c in CRITERIA):
        raise LLMError(f"score JSON missing criteria: {data}")
    return TurnScore(
        relevance=_clamp_score(data.get("relevance")),
        clarity=_clamp_score(data.get("clarity")),
        content=_clamp_score(data.get("content")),
        teamwork=_clamp_score(data.get("teamwork")),
        comment=_one_line(data.get("comment"), 200) or "No comment.",
    )


# --------------------------------------------------------------------------------------
# Leaderboard
# --------------------------------------------------------------------------------------


class _PlayerLike(Protocol):
    id: int
    name: str
    is_ai: bool


class _EntryLike(Protocol):
    participant_id: int
    scores: dict[str, int] | None
    turn_score: float | None


class _AdjustmentLike(Protocol):
    participant_id: int
    delta: float


def compute_leaderboard(
    players: Iterable[_PlayerLike],
    entries: Iterable[_EntryLike],
    adjustments: Iterable[_AdjustmentLike],
) -> list[dict[str, Any]]:
    """total_score = sum of turn scores (each 0-10, mean of the 4 criteria) + moderator adjustments."""
    entries = list(entries)
    adjustments = list(adjustments)
    rows: list[dict[str, Any]] = []
    for p in players:
        mine = [e for e in entries if e.participant_id == p.id]
        scored = [e for e in mine if e.turn_score is not None and e.scores]
        adj = round(sum(a.delta for a in adjustments if a.participant_id == p.id), 2)
        rows.append(
            {
                "participant_id": p.id,
                "name": p.name,
                "is_ai": p.is_ai,
                "turns": len(mine),
                "scored_turns": len(scored),
                "average": {
                    c: (round(mean(e.scores[c] for e in scored), 2) if scored else None)  # type: ignore[index]
                    for c in CRITERIA
                },
                "average_turn_score": round(mean(e.turn_score for e in scored), 2) if scored else None,  # type: ignore[misc]
                "adjustments": adj,
                "total_score": round(sum(e.turn_score for e in scored) + adj, 2),  # type: ignore[misc]
            }
        )
    rows.sort(key=lambda r: (-r["total_score"], -(r["average_turn_score"] or 0), r["name"].lower()))
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return rows


# --------------------------------------------------------------------------------------
# Final report feedback
# --------------------------------------------------------------------------------------

REPORT_SYSTEM = (
    "You are a GD coach writing a concise post-discussion report for ONE participant. "
    "Be specific and refer to what they actually said. "
    'Respond with JSON only: {"strengths": ["2-3 short strings"], '
    '"improvements": ["2-3 short, actionable strings"], "summary": "one-sentence overall verdict"}'
)

_CRITERION_STRENGTH = {
    "relevance": "Stayed relevant to the topic and the flow of discussion",
    "clarity": "Expressed ideas clearly and concisely",
    "content": "Brought substantive arguments and examples",
    "teamwork": "Engaged constructively with other participants",
}
_CRITERION_IMPROVE = {
    "relevance": "Tie each point back to the topic and to what was just said",
    "clarity": "Structure points as claim, reason, example to stay crisp",
    "content": "Support claims with data, facts or concrete examples",
    "teamwork": "Acknowledge and build on others' points by name",
}


async def generate_feedback(
    llm: LLMClient,
    *,
    topic: str,
    name: str,
    turns: list[tuple[str, dict[str, int] | None, str | None]],
    stats: dict[str, Any],
) -> dict[str, Any]:
    turn_lines = []
    for i, (text, scores, comment) in enumerate(turns, start=1):
        score_txt = ", ".join(f"{k} {v}" for k, v in scores.items()) if scores else "unscored"
        turn_lines.append(f'{i}. "{text}" [{score_txt}]' + (f" - {comment}" if comment else ""))
    avg = ", ".join(f"{k} {v}" for k, v in stats["average"].items() if v is not None) or "n/a"
    messages: list[Message] = [
        {"role": "system", "content": REPORT_SYSTEM},
        {
            "role": "user",
            "content": (
                f'GD topic: "{topic}"\nParticipant: {name}\n'
                f"Average scores (0-10): {avg}\nTotal score: {stats['total_score']} "
                f"(rank {stats['rank']})\n\nTheir turns:\n" + "\n".join(turn_lines)
            ),
        },
    ]
    data = await llm.chat_json(messages, temperature=0.4, max_tokens=400, purpose="report", metadata={"name": name})
    strengths = _str_list(data.get("strengths"))
    improvements = _str_list(data.get("improvements"))
    if not strengths and not improvements:
        raise LLMError(f"feedback JSON missing fields: {data}")
    return {
        "strengths": strengths,
        "improvements": improvements,
        "summary": _one_line(data.get("summary"), 300) or "",
    }


def fallback_feedback(stats: dict[str, Any]) -> dict[str, Any]:
    """Heuristic feedback used when the LLM is unavailable."""
    avg = {k: v for k, v in stats["average"].items() if v is not None}
    if not avg:
        return no_contribution_feedback()
    ordered = sorted(avg, key=avg.get, reverse=True)  # type: ignore[arg-type]
    return {
        "strengths": [_CRITERION_STRENGTH[c] for c in ordered[:2]],
        "improvements": [_CRITERION_IMPROVE[c] for c in ordered[-2:][::-1]],
        "summary": f"Average turn score {stats['average_turn_score']}/10 across {stats['turns']} turn(s).",
    }


def no_contribution_feedback() -> dict[str, Any]:
    return {
        "strengths": [],
        "improvements": [
            "Raise your hand early and make at least 2-3 contributions",
            "Open with a clear stance, even a short one, to get into the discussion",
        ],
        "summary": "Did not contribute to the discussion.",
    }


def _clamp_score(value: Any) -> int:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 5
    return int(round(min(10.0, max(0.0, f))))


def _one_line(value: Any, limit: int) -> str:
    if value is None:
        return ""
    s = " ".join(str(value).split())
    return s[:limit]


def _str_list(value: Any, limit: int = 3) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out = [_one_line(v, 200) for v in value if str(v).strip()]
    return out[:limit]

