# GDArena — Frontend

Web client for the GDArena real-time Group Discussion practice app, built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **lucide-react**.

Connects to the FastAPI + WebSocket backend in `../backend` strictly following `../backend/API_CONTRACT.md`.

---

## Project Structure

```text
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout & light theme base
│   │   ├── globals.css           # Inter font & Tailwind directives
│   │   ├── page.tsx              # Home / Room Setup screen
│   │   ├── join/
│   │   │   └── page.tsx          # Join screen (room code, name, Player/Moderator)
│   │   └── room/
│   │       └── [code]/
│   │           └── page.tsx      # Live Room screen (Lobby, Running, Results)
│   ├── components/
│   │   ├── AppHeader.tsx         # Top navigation bar
│   │   ├── TimerBanner.tsx       # Topic banner + server-authoritative countdown & turn timers
│   │   ├── RoundTable.tsx        # Circular round-table seating (2–10 seats)
│   │   ├── TurnControls.tsx      # Raise hand, text submission, voice placeholder
│   │   ├── TranscriptPanel.tsx   # Auto-scrolling live transcript
│   │   ├── LeaderboardPanel.tsx  # Live leaderboard table
│   │   ├── ModeratorPanel.tsx    # Start/End GD, skip/grant turn, +/- points, score comments
│   │   ├── LobbyPanel.tsx        # Pre-start lobby view & room sharing
│   │   └── ResultsView.tsx       # Final leaderboard, best performer, per-participant reports
│   ├── hooks/
│   │   └── useRoomSocket.ts      # Single WS hook handling all events & auto-reconnect
│   └── lib/
│       ├── types.ts              # TypeScript interfaces matching backend schemas
│       ├── config.ts             # API & WebSocket base URL resolution
│       ├── api.ts                # Typed REST client & error handling
│       ├── storage.ts            # Session persistence (sessionStorage + localStorage)
│       └── format.ts             # Time, score, and label formatting helpers
├── .env.example
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Setup & Run Instructions

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Default values (already match the local backend):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### 3. Start the development server

```bash
npm run dev
```

Open `http://localhost:3000`.

### 4. Production build & checks

```bash
npm run typecheck
npm run lint
npm run build
npm run start
```

---

## Running Backend and Frontend Together

1. **Terminal 1 — Backend (`/backend`):**

   ```bash
   cd backend
   source .venv/bin/activate
   # Copy .env.example to .env and add GROQ_API_KEY (or set LLM_PROVIDER=mock for offline testing)
   uvicorn app.main:app --reload --port 8000
   ```

2. **Terminal 2 — Frontend (`/frontend`):**

   ```bash
   cd frontend
   npm run dev
   ```

---

## Testing with Two Browser Tabs (Moderator + Player)

1. **Tab 1 (Moderator):**
   - Go to `http://localhost:3000`.
   - Choose a topic (or select **Let moderator choose**), pick participant count (e.g., `6`), set duration (e.g., `2` minutes for a quick test), optionally toggle a per-turn limit, and click **Create Room**.
   - On the Join screen, note/copy the 6-character room code, enter a name (e.g., `Moderator`), select **Moderator**, and click **Join Room**.
   - You will land in the Lobby with the **Start Discussion** button.
2. **Tab 2 (Player):**
   - Open `http://localhost:3000/join` (or paste the **Copy Join Link** URL from Tab 1).
   - Enter the room code, a different name (e.g., `Asha`), select **Player**, and click **Join Room**.
   - You will appear in the Lobby on both tabs and see *"Waiting for moderator to start the GD..."*.
3. **Run the GD:**
   - In **Tab 1 (Moderator)**, click **Start Discussion**. Empty seats fill automatically with AI participants, and the server countdown timer begins ticking every second on both tabs.
   - In **Tab 2 (Player)**, click **Raise Hand**. When given the floor (your seat highlights with a solid blue border and **Speaking** badge), type a point and submit.
   - In **Tab 1 (Moderator)**, open the **Moderator Panel** to adjust points (`+1`, `+0.5`, `-0.5`, `-1`), review LLM score comments under **Score Comments**, skip a speaker, or click **End GD**.
   - Refresh either tab mid-session to confirm the participant stays connected without losing their seat or role.
4. **Results:**
   - Once time expires or the moderator clicks **End GD**, both tabs transition to the Results screen showing the Best Performer, Final Leaderboard, and per-participant strengths and improvements.

