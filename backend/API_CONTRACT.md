# GD Arena — API Contract

Reference for building the frontend against the GD Arena backend.

- **Base URL (dev):** `http://localhost:8000`
- **WebSocket URL (dev):** `ws://localhost:8000/ws/{code}`
- **Timestamps:** ISO-8601 UTC strings ending in `Z` (e.g. `"2026-11-25T07:00:00.123Z"`).
- **Room codes:** 6 uppercase alphanumeric characters (case-insensitive in URLs, always returned uppercase).

---

## Common Error Format (REST)

Domain errors return an appropriate 4xx status with:

```json
{
  "error": {
    "code": "room_full",
    "message": "All seats are taken."
  }
}
```

Request schema validation errors return FastAPI's standard `422 Unprocessable Entity`.

---

## Shared Data Shapes

### `Room`
```json
{
  "code": "K7M9PQ",
  "topic": "Should companies adopt a four-day work week?",
  "topic_category": "business",
  "topic_source": "bank",
  "status": "lobby",
  "max_participants": 5,
  "seats_taken": 1,
  "duration_seconds": 600,
  "turn_limit_seconds": null,
  "fill_with_ai": true,
  "has_moderator": true,
  "created_at": "2026-11-25T07:00:00.000Z",
  "started_at": null,
  "ends_at": null,
  "ended_at": null,
  "end_reason": null
}
```
- `topic_source`: `"user" | "bank"`
- `topic_category`: `"current_affairs" | "business" | "social" | "abstract" | null` (`null` when `topic_source` is `"user"`)
- `status`: `"lobby" | "running" | "finished"`
- `end_reason`: `"timer" | "moderator" | "server_restart" | null`

### `Participant`
```json
{
  "id": 2,
  "name": "Arjun",
  "role": "player",
  "is_ai": true,
  "persona": {
    "key": "aggressive_debater",
    "label": "Aggressive Debater",
    "description": "Assertive; takes strong stances and challenges weak arguments head-on."
  },
  "connected": true,
  "hand_raised": false,
  "is_speaking": false,
  "can_moderate": false
}
```
- `role`: `"player" | "moderator"` (`moderator` does not occupy a player seat and is not on the leaderboard)
- `persona`: object for AI participants, `null` for humans
- `can_moderate`: `true` for the moderator, or for the first human player (host) if no moderator has joined

### `Timer`
```json
{
  "status": "running",
  "duration_seconds": 600,
  "remaining_seconds": 542,
  "elapsed_seconds": 58,
  "ends_at": "2026-11-25T07:10:00.000Z",
  "turn_limit_seconds": 45,
  "turn_remaining_seconds": 31
}
```
- `turn_remaining_seconds`: `null` when nobody is speaking or when `turn_limit_seconds` is `null`.

### `Speaker`
```json
{
  "participant_id": 2,
  "name": "Arjun",
  "is_ai": true,
  "seq": 3,
  "phase": "speaking",
  "started_at": "2026-11-25T07:01:05.000Z",
  "deadline_at": null
}
```
- `phase`: `"thinking"` (AI generating its point) or `"speaking"` (human typing/speaking, or AI holding the floor while its point is read/played)

### `QueueItem`
```json
{
  "participant_id": 1,
  "name": "Asha",
  "is_ai": false
}
```

### `TranscriptEntry`
```json
{
  "turn_id": 14,
  "seq": 3,
  "participant_id": 1,
  "name": "Asha",
  "is_ai": false,
  "text": "A four-day week works well in knowledge industries if output metrics are clear.",
  "source": "text",
  "audio_url": null,
  "started_at": "2026-11-25T07:01:05.000Z",
  "ended_at": "2026-11-25T07:01:22.000Z",
  "scores": {
    "relevance": 8,
    "clarity": 8,
    "content": 7,
    "teamwork": 7
  },
  "comment": "Clear stance; add one real-world example next time.",
  "turn_score": 7.5
}
```
- `source`: `"text" | "voice" | "ai"`
- `scores`, `comment`, `turn_score`: initially `null` when the entry is broadcast, then filled asynchronously when `turn_scored` arrives. `turn_score` is the mean of the 4 criteria (`0..10`).

### `LeaderboardRow`
```json
{
  "rank": 1,
  "participant_id": 1,
  "name": "Asha",
  "is_ai": false,
  "turns": 3,
  "scored_turns": 3,
  "average": {
    "relevance": 8.0,
    "clarity": 7.67,
    "content": 7.33,
    "teamwork": 7.67
  },
  "average_turn_score": 7.67,
  "adjustments": 1.5,
  "total_score": 24.5
}
```
- `total_score = sum(turn_score for scored turns) + adjustments`.

### `RoomSnapshot`
```json
{
  "room": { "...Room..." },
  "participants": [ "...Participant..." ],
  "timer": { "...Timer..." },
  "current_speaker": null,
  "queue": [ "...QueueItem..." ],
  "transcript": [ "...TranscriptEntry..." ],
  "leaderboard": [ "...LeaderboardRow..." ],
  "report_status": null,
  "report": null
}
```
- `report_status`: `null | "generating" | "ready" | "failed"`

### `FinalReport`
```json
{
  "room_code": "K7M9PQ",
  "topic": "Should companies adopt a four-day work week?",
  "generated_at": "2026-11-25T07:10:06.210Z",
  "started_at": "2026-11-25T07:00:00.000Z",
  "ended_at": "2026-11-25T07:10:00.000Z",
  "end_reason": "timer",
  "total_turns": 12,
  "best_performer": {
    "participant_id": 1,
    "name": "Asha",
    "is_ai": false,
    "total_score": 24.5,
    "reason": "Consistent, well-structured points that engaged other speakers."
  },
  "participants": [
    {
      "participant_id": 1,
      "name": "Asha",
      "is_ai": false,
      "persona": null,
      "rank": 1,
      "total_score": 24.5,
      "turns": 3,
      "average": {
        "relevance": 8.0,
        "clarity": 7.67,
        "content": 7.33,
        "teamwork": 7.67
      },
      "average_turn_score": 7.67,
      "adjustments": 1.5,
      "strengths": ["Took a clear position early", "Built on others' points"],
      "improvements": ["Back claims with concrete numbers"],
      "summary": "Consistent, well-structured points that engaged other speakers."
    }
  ]
}
```
- `best_performer` is `null` if nobody spoke during the GD.

---

## REST Endpoints

### `GET /health`
Server health and active provider info.

- **200 OK:**
```json
{
  "status": "ok",
  "llm_provider": "groq",
  "llm_model": "llama-3.3-70b-versatile",
  "stt_provider": "text"
}
```

---

### `GET /topics`
List the built-in GD topic bank.

- **Query params:** `category` (optional): `current_affairs | business | social | abstract`
- **200 OK:**
```json
{
  "categories": {
    "current_affairs": "Current Affairs",
    "business": "Business & Economy",
    "social": "Social Issues",
    "abstract": "Abstract"
  },
  "topics": [
    { "id": "ca-01", "title": "...", "category": "current_affairs" }
  ]
}
```

---

### `GET /personas`
List all available AI personas.

- **200 OK:**
```json
{
  "personas": [
    {
      "key": "aggressive_debater",
      "label": "Aggressive Debater",
      "description": "Assertive; takes strong stances and challenges weak arguments head-on.",
      "name": "Arjun"
    }
  ]
}
```

---

### `POST /rooms`
Create a new GD room in `lobby` state.

- **Request body:**
```json
{
  "topic": null,
  "topic_category": null,
  "max_participants": 5,
  "duration_seconds": 600,
  "turn_limit_seconds": null,
  "fill_with_ai": true
}
```
  All fields are optional:
  - `topic`: `string | null` (max 300 chars; `null` or blank picks a random topic from `topics.json`)
  - `topic_category`: `"current_affairs" | "business" | "social" | "abstract" | null` (used only when `topic` is `null`)
  - `max_participants`: `int`, `2..10` (default `5`)
  - `duration_seconds`: `int`, `30..3600` (default `600`)
  - `turn_limit_seconds`: `int | null`, `10..600` (default `null` = off)
  - `fill_with_ai`: `bool` (default `true`)
- **201 Created:** returns a `Room` object (including its generated `code`).

---

### `GET /rooms/{code}`
Fetch the full live state of a room.

- **200 OK:** `RoomSnapshot`
- **404 Not Found:** `room_not_found`

---

### `POST /rooms/{code}/join`
Join a room as a player or moderator and receive a personal WebSocket token.

- **Request body:**
```json
{
  "name": "Asha",
  "role": "player"
}
```
  - `name`: `string`, 1..40 chars, unique per room (case-insensitive)
  - `role`: `"player" | "moderator"` (default `"player"`; at most one moderator per room; players can only join while `status == "lobby"`)
- **201 Created:**
```json
{
  "participant": { "...Participant..." },
  "token": "opaque-secret-token",
  "ws_url": "/ws/K7M9PQ?token=opaque-secret-token",
  "room": { "...Room..." }
}
```
- **Errors:**
  - `404` `room_not_found`
  - `409` `room_finished` | `name_taken` | `moderator_taken` | `already_started` | `room_full`

---

### `GET /rooms/{code}/transcript`
Fetch all completed turns.

- **200 OK:** `{ "transcript": [ "...TranscriptEntry..." ] }`
- **404 Not Found:** `room_not_found`

---

### `GET /rooms/{code}/leaderboard`
Fetch the live or final leaderboard.

- **200 OK:** `{ "leaderboard": [ "...LeaderboardRow..." ] }`
- **404 Not Found:** `room_not_found`

---

### `GET /rooms/{code}/report`
Fetch the end-of-GD report.

- **200 OK:** `FinalReport`
- **202 Accepted:** `{ "status": "generating" }` (still generating; clients connected via WS will receive `report_ready`)
- **409 Conflict:** `not_finished` (GD has not ended yet)
- **404 Not Found:** `room_not_found` | `report_unavailable`

---

## WebSocket: `/ws/{code}`

Connect to:
- **Participant / Moderator:** `ws://<host>/ws/{code}?token=<token>`
- **Read-only Spectator:** `ws://<host>/ws/{code}` (receives all broadcasts; any command other than `ping` / `get_state` returns `spectator_read_only`)

### Handshake Error Close Codes
Before closing on auth/lookup failure, the server sends one `error` event:
- `4404` — `room_not_found`
- `4401` — `invalid_token`
- `1013` — client send buffer overflowed (slow consumer disconnected)

### Message Envelope

**Server -> Client:**
```json
{
  "type": "<event_name>",
  "data": { ... },
  "ts": "2026-11-25T07:00:00.123Z"
}
```

**Client -> Server:**
```json
{
  "type": "<command_name>",
  "request_id": "optional-client-correlation-id"
}
```
`request_id` is optional; when provided, it is echoed on `pong` and `error` responses.

---

### Client -> Server Commands

| `type` | Who | Payload fields | Effect |
|---|---|---|---|
| `ping` | Any | `request_id?` | Server replies with `pong`. |
| `get_state` | Any | — | Server replies with `state` (`RoomSnapshot`). |
| `start_gd` | Moderator / Host | — | `lobby -> running`; fills empty seats with AI (if `fill_with_ai`), starts timer. |
| `end_gd` | Moderator / Host | — | `running -> finished` (`reason: "moderator"`), triggers final report. |
| `raise_hand` | Player (running) | — | Joins the raise-hand queue (immediately gets floor if free). |
| `lower_hand` | Player or Moderator | `participant_id?` | Removes self from queue; moderator may pass `participant_id` to lower another player's hand. |
| `submit_turn` | Current speaker | `text` (or voice-ready `audio_b64`, `mime_type`, `language?`) | Submits the turn, appends to transcript, triggers async LLM scoring, advances floor. |
| `yield_turn` | Current speaker | — | Gives up the floor without speaking (`turn_skipped` with `reason: "yielded"`). |
| `grant_turn` | Moderator / Host | `participant_id` | Gives the floor to a specific player when the floor is free. |
| `skip_speaker` | Moderator / Host | — | Ends the active speaker's turn (`turn_skipped` with `reason: "moderator_skip"`) and advances. |
| `adjust_score` | Moderator / Host (running) | `participant_id`, `delta` (`-10..10`, non-zero), `reason?` | Adds or subtracts points and updates the leaderboard. |

**Voice-ready `submit_turn` example (stage 1 text vs. stage 2 audio):**
```json
{ "type": "submit_turn", "text": "I agree with Meera, and here is why..." }
```
```json
{ "type": "submit_turn", "audio_b64": "<base64>", "mime_type": "audio/webm", "language": "en" }
```
In stage 1 (`STT_PROVIDER=text`), sending `audio_b64` without `text` returns an `error` event with `code: "voice_not_supported"`.

---

### Server -> Client Events

| `type` | Delivery | `data` shape | When sent |
|---|---|---|---|
| `welcome` | Unicast | `{ "you": Participant \| null, "state": RoomSnapshot }` | Immediately after connecting (and reconnecting). |
| `state` | Unicast | `RoomSnapshot` | Reply to `get_state`. |
| `pong` | Unicast | `{ "request_id": any \| null }` | Reply to `ping`. |
| `participants` | Broadcast | `{ "participants": Participant[] }` | Join, connect/disconnect, or AI fill on start. |
| `gd_started` | Broadcast | `{ "topic", "started_at", "ends_at", "duration_seconds", "turn_limit_seconds", "participants" }` | Transition `lobby -> running`. |
| `timer` | Broadcast | `Timer` | Every 1 second while running, plus once when ended. |
| `queue` | Broadcast | `{ "queue": QueueItem[] }` | Raise hand, lower hand, pop next speaker, or clear on end. |
| `speaker_changed` | Broadcast | `{ "speaker": Speaker \| null }` | Floor granted, AI phase changes `thinking -> speaking`, or floor released. |
| `transcript_entry` | Broadcast | `TranscriptEntry` | A human or AI finishes submitting a turn (scores start as `null`). |
| `turn_skipped` | Broadcast | `{ "participant_id", "name", "seq", "reason" }` | Turn ended without text (`yielded`, `time_up`, `disconnected`, `moderator_skip`, `ai_error`). |
| `turn_scored` | Broadcast | `{ "turn_id", "seq", "participant_id", "name", "scores", "comment", "turn_score" }` | Async LLM scoring finishes for a turn. |
| `score_adjusted` | Broadcast | `{ "participant_id", "name", "delta", "reason", "by": { "participant_id", "name" }, "created_at" }` | Moderator adjusted a player's score. |
| `leaderboard` | Broadcast | `{ "leaderboard": LeaderboardRow[] }` | After every `turn_scored` and `score_adjusted`. |
| `gd_ended` | Broadcast | `{ "reason", "ended_at", "elapsed_seconds", "leaderboard" }` | Transition `running -> finished`. |
| `report_ready` | Broadcast | `{ "report": FinalReport }` | Async final report finishes generating. |
| `report_failed` | Broadcast | `{ "message": string }` | Report generation failed unexpectedly. |
| `error` | Unicast | `{ "code", "message", "request_type"?, "request_id"? }` | Invalid message, permission failure, or state conflict. |

### Common WebSocket Error Codes
`room_not_found`, `invalid_token`, `spectator_read_only`, `invalid_message`, `message_too_large`, `unknown_type`, `not_moderator`, `not_player`, `invalid_state`, `not_enough_participants`, `already_queued`, `already_speaking`, `not_your_turn`, `empty_turn`, `invalid_turn`, `voice_not_supported`, `floor_busy`, `no_speaker`, `not_found`, `internal_error`.

