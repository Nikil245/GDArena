#!/usr/bin/env python3
"""Run a complete fake GD end-to-end over the real REST + WebSocket API.

By default it boots its own server (temp SQLite DB, offline mock LLM) on a free port:

    python scripts/run_fake_gd.py                     # mock LLM, 40s GD
    python scripts/run_fake_gd.py --real              # use the LLM from backend/.env (Groq)
    python scripts/run_fake_gd.py --base-url http://localhost:8000   # against a running server

Cast: a human moderator ("Moderator"), one scripted human player ("Tester") who raises a
hand and submits text turns, and AI participants filling the remaining seats. The
moderator adjusts scores during the GD; the GD ends on the timer (or --end-after N
seconds via end_gd), then the script waits for the final report and verifies it.
Exit code 0 = success.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
import websockets

BACKEND_DIR = Path(__file__).resolve().parent.parent

HUMAN_LINES = [
    "I think we need to separate the short-term disruption from the long-term benefit. "
    "Most of the concerns raised so far are about transition costs, which can be managed with good policy.",
    "Building on the last point, I'd add that any solution must be measurable. "
    "If we can't track outcomes, we can't hold anyone accountable.",
    "To summarise where we are: we broadly agree on the goal but disagree on the pace. "
    "A phased rollout with clear review points seems like a fair middle ground.",
]


class Failure(Exception):
    pass


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int, env_overrides: dict[str, str], quiet: bool) -> subprocess.Popen:
    env = os.environ.copy()
    env.update(env_overrides)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port),
         "--log-level", "warning"],
        cwd=BACKEND_DIR,
        env=env,
        stdout=subprocess.DEVNULL if quiet else None,
        stderr=subprocess.DEVNULL if quiet else None,
    )
    deadline = time.time() + 20
    while time.time() < deadline:
        if proc.poll() is not None:
            raise Failure("server exited during startup")
        try:
            if httpx.get(f"http://127.0.0.1:{port}/health", timeout=1).status_code == 200:
                return proc
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    proc.terminate()
    raise Failure("server did not start in time")


def log(quiet: bool, *parts: Any) -> None:
    if not quiet:
        print(*parts, flush=True)


async def run_gd(base_url: str, args: argparse.Namespace) -> dict[str, Any]:
    q = args.quiet
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as http:
        health = (await http.get("/health")).json()
        log(q, f"Server OK - LLM: {health['llm_provider']} / {health['llm_model']}")

        r = await http.post("/rooms", json={
            "topic": args.topic,
            "max_participants": args.participants,
            "duration_seconds": args.duration,
            "turn_limit_seconds": args.turn_limit,
        })
        if r.status_code != 201:
            raise Failure(f"create room failed: {r.status_code} {r.text}")
        room = r.json()
        code = room["code"]
        log(q, f"Room {code} | topic ({room['topic_source']}): {room['topic']}")

        mod = (await http.post(f"/rooms/{code}/join", json={"name": "Moderator", "role": "moderator"})).json()
        human = (await http.post(f"/rooms/{code}/join", json={"name": "Tester", "role": "player"})).json()
        dup = await http.post(f"/rooms/{code}/join", json={"name": "tester", "role": "player"})
        if dup.status_code != 409:
            raise Failure("duplicate name should be rejected with 409")

    human_id = human["participant"]["id"]
    ws_base = base_url.replace("http", "ws", 1)
    names: dict[int, str] = {}
    result: dict[str, Any] = {"code": code, "human_id": human_id, "errors": [], "events": {}}
    done = asyncio.Event()

    async with websockets.connect(f"{ws_base}/ws/{code}?token={mod['token']}") as mod_ws, \
               websockets.connect(f"{ws_base}/ws/{code}?token={human['token']}") as human_ws:

        async def send(ws: Any, payload: dict[str, Any]) -> None:
            await ws.send(json.dumps(payload))

        async def moderator_loop() -> None:
            adjusted_human = adjusted_ai = False
            async for raw in mod_ws:
                ev = json.loads(raw)
                t, d = ev["type"], ev["data"]
                result["events"][t] = result["events"].get(t, 0) + 1
                if t == "welcome":
                    if not d["you"]["can_moderate"]:
                        raise Failure("moderator should be able to moderate")
                elif t in ("participants", "gd_started"):
                    for p in d["participants"]:
                        names[p["id"]] = p["name"]
                    if t == "gd_started":
                        ais = [p for p in d["participants"] if p["is_ai"]]
                        log(q, f"\n=== GD started ({d['duration_seconds']}s) with {len(d['participants']) - 1} "
                               f"players; AI: " + ", ".join(f"{p['name']} [{p['persona']['label']}]" for p in ais))
                elif t == "timer":
                    if d["remaining_seconds"] % 10 == 0:
                        log(q, f"  [timer] {d['remaining_seconds']}s left")
                elif t == "queue":
                    if d["queue"]:
                        log(q, "  [queue] " + ", ".join(x["name"] for x in d["queue"]))
                elif t == "speaker_changed" and d["speaker"]:
                    s = d["speaker"]
                    log(q, f"  [floor] {s['name']} ({s['phase']})")
                elif t == "transcript_entry":
                    log(q, f"\n> {d['name']}{' (AI)' if d['is_ai'] else ''}: {d['text']}")
                elif t == "turn_skipped":
                    log(q, f"  [skipped] {d['name']}: {d['reason']}")
                elif t == "turn_scored":
                    s = d["scores"]
                    log(q, f"  [score] {d['name']}: R{s['relevance']} C{s['clarity']} Co{s['content']} "
                           f"T{s['teamwork']} = {d['turn_score']} - {d['comment']}")
                    if d["participant_id"] == human_id and not adjusted_human:
                        adjusted_human = True
                        await send(mod_ws, {"type": "adjust_score", "participant_id": human_id,
                                            "delta": 1.5, "reason": "Good summarising"})
                    elif d["participant_id"] != human_id and not adjusted_ai:
                        adjusted_ai = True
                        await send(mod_ws, {"type": "adjust_score", "participant_id": d["participant_id"],
                                            "delta": -1, "reason": "Interrupted others"})
                elif t == "score_adjusted":
                    log(q, f"  [moderator] {d['delta']:+} to {d['name']} ({d['reason']})")
                elif t == "gd_ended":
                    log(q, f"\n=== GD ended ({d['reason']}) after {d['elapsed_seconds']}s - generating report...")
                    result["end_reason"] = d["reason"]
                elif t == "report_ready":
                    result["report"] = d["report"]
                    done.set()
                    return
                elif t == "report_failed":
                    raise Failure("report generation failed")
                elif t == "error":
                    result["errors"].append(d)
                    log(q, f"  [error] {d}")

        async def human_loop() -> None:
            spoken = 0
            others_since_mine = 99
            queued = speaking = running = False
            async for raw in human_ws:
                ev = json.loads(raw)
                t, d = ev["type"], ev["data"]
                if t == "gd_started":
                    running = True
                    await asyncio.sleep(1.5)
                elif t == "gd_ended":
                    return
                elif t == "queue":
                    queued = any(x["participant_id"] == human_id for x in d["queue"])
                elif t == "speaker_changed":
                    speaking = bool(d["speaker"]) and d["speaker"]["participant_id"] == human_id
                    if speaking:
                        await asyncio.sleep(0.5)  # "typing"
                        await send(human_ws, {"type": "submit_turn", "text": HUMAN_LINES[spoken % len(HUMAN_LINES)]})
                        spoken += 1
                        others_since_mine = 0
                elif t == "transcript_entry" and d["participant_id"] != human_id:
                    others_since_mine += 1
                elif t == "error":
                    result["errors"].append(d)
                if running and not queued and not speaking and others_since_mine >= 2:
                    queued = True
                    await send(human_ws, {"type": "raise_hand"})

        # Wait for both welcomes, then start.
        await asyncio.sleep(0.5)
        mod_task = asyncio.create_task(moderator_loop())
        human_task = asyncio.create_task(human_loop())
        await send(mod_ws, {"type": "start_gd"})
        await send(human_ws, {"type": "start_gd"})  # host rule: players can't start when a moderator exists

        async def end_early() -> None:
            if args.end_after:
                await asyncio.sleep(args.end_after)
                await send(mod_ws, {"type": "end_gd"})

        early = asyncio.create_task(end_early())
        try:
            await asyncio.wait_for(done.wait(), timeout=args.duration + 120)
        except asyncio.TimeoutError:
            raise Failure("timed out waiting for the report") from None
        finally:
            early.cancel()
            for task in (mod_task, human_task):
                task.cancel()
            for task in (mod_task, human_task):
                try:
                    await task
                except (asyncio.CancelledError, websockets.ConnectionClosed):
                    pass

    async with httpx.AsyncClient(base_url=base_url, timeout=30) as http:
        result["state"] = (await http.get(f"/rooms/{code}")).json()
        result["report_rest"] = (await http.get(f"/rooms/{code}/report")).json()
    return result


def verify(result: dict[str, Any], args: argparse.Namespace) -> None:
    state, report = result["state"], result["report"]
    transcript = state["transcript"]
    human_id = result["human_id"]
    players = [p for p in state["participants"] if p["role"] == "player"]

    def check(cond: bool, msg: str) -> None:
        if not cond:
            raise Failure(msg)

    check(state["room"]["status"] == "finished", "room should be finished")
    check(len(players) == args.participants, f"expected {args.participants} players (AI-filled)")
    check(sum(p["is_ai"] for p in players) == args.participants - 1, "empty seats should be AI")
    check(len({p["persona"]["key"] for p in players if p["is_ai"]}) == args.participants - 1, "AI personas must be distinct")
    check(len(transcript) >= 3, f"expected >= 3 turns, got {len(transcript)}")
    check(any(e["participant_id"] == human_id for e in transcript), "the human should have spoken")
    check(any(e["is_ai"] for e in transcript), "AIs should have spoken")
    check(all(len(e["text"].split()) <= 60 for e in transcript if e["is_ai"]), "AI turns must be <= 60 words")
    check(any(e["scores"] for e in transcript), "turns should be scored")
    codes = {e["code"] for e in result["errors"]}
    check("not_moderator" in codes, "player start_gd should be rejected with not_moderator")
    check(result["events"].get("timer", 0) >= 3, "timer should broadcast every second")
    check(result["events"].get("score_adjusted", 0) >= 1, "moderator adjustment should be broadcast")
    human_row = next(r for r in state["leaderboard"] if r["participant_id"] == human_id)
    check(human_row["adjustments"] == 1.5, "human adjustment should be on the leaderboard")
    check(report["best_performer"] is not None, "report must name a best performer")
    check(len(report["participants"]) == args.participants, "report must cover every player")
    check(report == result["report_rest"], "REST report should match the WS report")
    for p in report["participants"]:
        check("strengths" in p and "improvements" in p and "total_score" in p, "incomplete participant report")


def print_summary(result: dict[str, Any]) -> None:
    report = result["report"]
    print("\n=== Leaderboard ===")
    for row in result["state"]["leaderboard"]:
        tag = "AI" if row["is_ai"] else "human"
        print(f"{row['rank']:>2}. {row['name']:<14} {tag:<5} total {row['total_score']:>6}  "
              f"turns {row['turns']}  avg {row['average_turn_score']}  adj {row['adjustments']:+}")
    print("\n=== Final report ===")
    best = report["best_performer"]
    print(f"Best performer: {best['name']} ({best['total_score']}) - {best['reason']}")
    for p in report["participants"]:
        print(f"\n#{p['rank']} {p['name']} - {p['total_score']} pts, {p['turns']} turns")
        print(f"   {p['summary']}")
        for s in p["strengths"]:
            print(f"   + {s}")
        for s in p["improvements"]:
            print(f"   - {s}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", help="Use an already running server instead of starting one")
    ap.add_argument("--real", action="store_true", help="Use the real LLM from backend/.env (default: mock)")
    ap.add_argument("--duration", type=int, default=40, help="GD duration in seconds (min 30)")
    ap.add_argument("--participants", type=int, default=4, help="Seats incl. the human tester (2-10)")
    ap.add_argument("--turn-limit", type=int, default=None, help="Per-turn limit in seconds")
    ap.add_argument("--topic", default=None, help="Topic (default: random from the bank)")
    ap.add_argument("--end-after", type=float, default=None, help="Moderator ends the GD after N seconds")
    ap.add_argument("--ai-wpm", default=None, help="AI simulated speaking speed (default 900 mock / 400 real)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    proc = None
    tmpdir = None
    try:
        if args.base_url:
            base_url = args.base_url.rstrip("/")
        else:
            tmpdir = tempfile.TemporaryDirectory()
            port = free_port()
            env = {
                "DATABASE_URL": f"sqlite:///{Path(tmpdir.name) / 'fake_gd.db'}",
                "AI_SPEAKING_WPM": str(args.ai_wpm or (400 if args.real else 900)),
                "LOG_LEVEL": "WARNING",
            }
            if not args.real:
                env["LLM_PROVIDER"] = "mock"
                env["TTS_PROVIDER"] = "none"
            proc = start_server(port, env, args.quiet)
            base_url = f"http://127.0.0.1:{port}"

        result = asyncio.run(run_gd(base_url, args))
        verify(result, args)
        if not args.quiet:
            print_summary(result)
        print(f"\nPASS - fake GD in room {result['code']} completed "
              f"({len(result['state']['transcript'])} turns, ended by {result.get('end_reason')}).")
        return 0
    except Failure as exc:
        print(f"\nFAIL - {exc}", file=sys.stderr)
        return 1
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        if tmpdir is not None:
            tmpdir.cleanup()


if __name__ == "__main__":
    sys.exit(main())

