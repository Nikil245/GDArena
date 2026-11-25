"""Topic bank (``app/data/topics.json``)."""

from __future__ import annotations

import json
import random
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

TOPICS_PATH = Path(__file__).resolve().parent.parent / "data" / "topics.json"


@dataclass(frozen=True)
class Topic:
    id: str
    title: str
    category: str

    def public(self) -> dict:
        return asdict(self)


@lru_cache
def _load() -> tuple[dict[str, str], tuple[Topic, ...]]:
    raw = json.loads(TOPICS_PATH.read_text(encoding="utf-8"))
    topics = tuple(Topic(id=t["id"], title=t["title"], category=t["category"]) for t in raw["topics"])
    return raw["categories"], topics


def categories() -> dict[str, str]:
    return dict(_load()[0])


def all_topics(category: str | None = None) -> list[Topic]:
    topics = _load()[1]
    return [t for t in topics if category is None or t.category == category]


def random_topic(category: str | None = None, rng: random.Random | None = None) -> Topic:
    pool = all_topics(category) or all_topics()
    return (rng or random).choice(pool)

