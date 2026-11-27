"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Clock,
  FileText,
  Loader2,
  Mic,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import {
  useBackendStatus,
  WarmupBanner,
} from "@/components/BackendStatusProvider";
import { PreStartLimitNotice } from "@/components/ServiceStatusBanner";
import { StyledSelect, type SelectOption } from "@/components/StyledSelect";
import { ApiError, createRoom } from "@/lib/api";
import type { TopicCategory } from "@/lib/types";

const PARTICIPANT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const CATEGORY_OPTIONS: readonly SelectOption<"" | TopicCategory>[] = [
  { value: "", label: "Any category" },
  { value: "current_affairs", label: "Current Affairs" },
  { value: "business", label: "Business & Economy" },
  { value: "social", label: "Social Issues" },
  { value: "abstract", label: "Abstract" },
];

const WHAT_YOU_GET_ITEMS = [
  {
    icon: Mic,
    title: "Voice-based discussion",
    detail: "Speak using your microphone with instant transcription.",
  },
  {
    icon: Users,
    title: "AI participants with distinct personas",
    detail: "Open seats fill automatically with balanced viewpoints.",
  },
  {
    icon: BarChart3,
    title: "Live scoring",
    detail: "Per-turn scores and a real-time leaderboard as you speak.",
  },
  {
    icon: FileText,
    title: "Final report",
    detail: "Strengths, improvement areas, and full session transcript.",
  },
] as const;

export default function HomePage() {
  const router = useRouter();
  const { overlayVisible } = useBackendStatus();

  const [topicMode, setTopicMode] = useState<"custom" | "moderator">(
    "moderator"
  );
  const [topicText, setTopicText] = useState("");
  const [topicCategory, setTopicCategory] = useState<"" | TopicCategory>("");
  const [maxParticipants, setMaxParticipants] = useState<number>(6);
  const [durationMinutes, setDurationMinutes] = useState<string>("10");
  const [turnLimitEnabled, setTurnLimitEnabled] = useState<boolean>(false);
  const [turnLimitSeconds, setTurnLimitSeconds] = useState<string>("45");
  const [joinCodeInput, setJoinCodeInput] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (topicMode === "custom" && !topicText.trim()) {
      setError("Enter a discussion topic or switch to Let moderator choose.");
      return;
    }

    const parsedMinutes = Number(durationMinutes);
    if (
      !Number.isFinite(parsedMinutes) ||
      parsedMinutes < 0.5 ||
      parsedMinutes > 60
    ) {
      setError("Duration must be between 0.5 and 60 minutes.");
      return;
    }
    const durationSeconds = Math.round(parsedMinutes * 60);

    let parsedTurnLimit: number | null = null;
    if (turnLimitEnabled) {
      const parsed = Math.round(Number(turnLimitSeconds));
      if (!Number.isFinite(parsed) || parsed < 10 || parsed > 600) {
        setError("Per-turn limit must be between 10 and 600 seconds.");
        return;
      }
      parsedTurnLimit = parsed;
    }

    setSubmitting(true);
    try {
      const room = await createRoom({
        topic: topicMode === "custom" ? topicText.trim() : null,
        topic_category:
          topicMode === "moderator" && topicCategory ? topicCategory : null,
        max_participants: maxParticipants,
        duration_seconds: durationSeconds,
        turn_limit_seconds: parsedTurnLimit,
        fill_with_ai: true,
      });
      router.push(`/join?code=${encodeURIComponent(room.code)}&created=1`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "request_in_flight") {
        return;
      }
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to create room. Please try again.");
      }
      setSubmitting(false);
    }
  };

  const handleQuickJoin = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = joinCodeInput.trim().toUpperCase();
    if (!cleaned) return;
    router.push(`/join?code=${encodeURIComponent(cleaned)}`);
  };

  return (
    <div className="min-h-screen bg-page">
      <AppHeader />

      <main className="app-container py-6 sm:py-10">
        <WarmupBanner />
        <PreStartLimitNotice />
        <div className="mb-6 sm:mb-8">
          <h1 className="text-page-title font-semibold text-ink sm:text-[28px]">
            Group Discussion Practice
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">
            Configure a structured practice room with a live moderator,
            server-synced timer, AI participants, and per-turn evaluation.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-12">
          {/* Setup Form */}
          <section className="ui-card p-5 sm:p-6 lg:col-span-8">
            <div className="mb-5 border-b border-line-subtle pb-3.5">
              <h2 className="text-section-title font-semibold text-ink">
                Create a Discussion Room
              </h2>
              <p className="mt-0.5 text-caption text-ink-muted">
                Empty seats are automatically filled by distinct AI personas when
                the moderator starts the session.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-control border border-danger-border bg-danger-bg px-3.5 py-2.5 text-sm text-danger-text"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  strokeWidth={1.75}
                />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-6">
              {/* Topic Selection */}
              <div>
                <span
                  id="topic-mode-label"
                  className="mb-2 block text-sm font-medium text-ink"
                >
                  Discussion Topic
                </span>
                <div
                  role="group"
                  aria-labelledby="topic-mode-label"
                  className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
                >
                  <button
                    type="button"
                    aria-pressed={topicMode === "moderator"}
                    onClick={() => setTopicMode("moderator")}
                    className={`ui-focus rounded-control px-3.5 py-3 text-left text-sm transition-colors duration-150 ${
                      topicMode === "moderator"
                        ? "border-2 border-accent bg-accent-soft text-accent-text"
                        : "border border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
                    }`}
                  >
                    <span className="block font-semibold">
                      Let moderator choose
                    </span>
                    <span className="mt-0.5 block text-caption text-ink-muted">
                      Random pick from topic bank
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={topicMode === "custom"}
                    onClick={() => setTopicMode("custom")}
                    className={`ui-focus rounded-control px-3.5 py-3 text-left text-sm transition-colors duration-150 ${
                      topicMode === "custom"
                        ? "border-2 border-accent bg-accent-soft text-accent-text"
                        : "border border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
                    }`}
                  >
                    <span className="block font-semibold">Custom topic</span>
                    <span className="mt-0.5 block text-caption text-ink-muted">
                      Enter your own prompt
                    </span>
                  </button>
                </div>

                {topicMode === "custom" ? (
                  <div className="mt-3">
                    <label
                      htmlFor="custom-topic"
                      className="mb-1.5 block text-caption font-medium text-ink-secondary"
                    >
                      Custom topic prompt
                    </label>
                    <input
                      id="custom-topic"
                      type="text"
                      maxLength={300}
                      value={topicText}
                      onChange={(e) => setTopicText(e.target.value)}
                      placeholder="e.g., Should companies adopt a four-day work week?"
                      className="ui-input"
                    />
                  </div>
                ) : (
                  <div className="mt-3">
                    <span
                      id="topic-category-label"
                      className="mb-1.5 block text-caption font-medium text-ink-secondary"
                    >
                      Topic category (optional)
                    </span>
                    <StyledSelect
                      id="topic-category"
                      ariaLabelledBy="topic-category-label"
                      value={topicCategory}
                      options={CATEGORY_OPTIONS}
                      onChange={setTopicCategory}
                    />
                  </div>
                )}
              </div>

              {/* Participants Selector */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span
                    id="participants-label"
                    className="flex items-center gap-1.5 text-sm font-medium text-ink"
                  >
                    <Users
                      className="h-4 w-4 text-ink-muted"
                      strokeWidth={1.75}
                    />
                    Participants
                  </span>
                  <span className="text-caption font-medium text-ink-muted">
                    {maxParticipants} seats (human + AI)
                  </span>
                </div>
                <div
                  role="group"
                  aria-labelledby="participants-label"
                  className="grid grid-cols-3 gap-2 sm:grid-cols-9"
                >
                  {PARTICIPANT_OPTIONS.map((count) => {
                    const selected = maxParticipants === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setMaxParticipants(count)}
                        className={`ui-focus h-10 rounded-control border text-sm font-medium tabular-nums transition-colors duration-150 ${
                          selected
                            ? "border-accent bg-accent font-semibold text-white"
                            : "border-line-input bg-surface text-ink hover:border-line-strong hover:bg-subtle"
                        }`}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Duration & Optional Turn Limit */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="duration-minutes"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink"
                  >
                    <Clock
                      className="h-4 w-4 text-ink-muted"
                      strokeWidth={1.75}
                    />
                    Duration (minutes)
                  </label>
                  <input
                    id="duration-minutes"
                    type="number"
                    min={0.5}
                    max={60}
                    step={0.5}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    className="ui-input tabular-nums"
                  />
                  <div
                    role="group"
                    aria-label="Duration shortcuts"
                    className="mt-2 grid grid-cols-4 gap-2"
                  >
                    {[5, 10, 15, 20].map((m) => {
                      const selected = Number(durationMinutes) === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setDurationMinutes(String(m))}
                          className={`ui-focus h-10 rounded-control border text-xs tabular-nums transition-colors duration-150 ${
                            selected
                              ? "border-accent bg-accent-soft font-semibold text-accent-text"
                              : "border-line-input bg-surface font-medium text-ink-secondary hover:border-line-strong hover:bg-subtle"
                          }`}
                        >
                          {m}m
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="ui-card-subtle flex flex-col justify-between p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label
                      htmlFor="turn-limit-toggle"
                      className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink"
                    >
                      <SlidersHorizontal
                        className="h-4 w-4 text-ink-muted"
                        strokeWidth={1.75}
                      />
                      Per-turn limit
                    </label>
                    <label className="inline-flex min-h-[28px] cursor-pointer items-center gap-2 text-caption font-medium text-ink-secondary">
                      <input
                        id="turn-limit-toggle"
                        type="checkbox"
                        checked={turnLimitEnabled}
                        onChange={(e) => setTurnLimitEnabled(e.target.checked)}
                        className="ui-focus h-4 w-4 rounded border-line-input accent-accent"
                      />
                      <span
                        className={`rounded-chip border px-1.5 py-0.5 text-[11px] font-semibold ${
                          turnLimitEnabled
                            ? "border-accent-border bg-accent-soft text-accent-text"
                            : "border-line bg-surface text-ink-muted"
                        }`}
                      >
                        {turnLimitEnabled ? "Active" : "Off"}
                      </span>
                    </label>
                  </div>

                  <label htmlFor="turn-limit-seconds" className="sr-only">
                    Seconds per turn
                  </label>
                  <input
                    id="turn-limit-seconds"
                    type="number"
                    min={10}
                    max={600}
                    step={5}
                    disabled={!turnLimitEnabled}
                    value={turnLimitSeconds}
                    onChange={(e) => setTurnLimitSeconds(e.target.value)}
                    placeholder="Seconds per turn"
                    className="ui-input tabular-nums"
                  />
                  <p className="mt-2 text-caption text-ink-muted">
                    {turnLimitEnabled
                      ? "10 to 600 seconds per speaker turn."
                      : "Enable above to cap how long each speaker holds the floor."}
                  </p>
                </div>
              </div>

              <div className="border-t border-line-subtle pt-5">
                <button
                  type="submit"
                  disabled={submitting || overlayVisible}
                  className="ui-btn-primary h-11 w-full px-6 sm:w-auto"
                >
                  {submitting && (
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  )}
                  {submitting ? "Creating Room..." : "Create Room"}
                  {!submitting && (
                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* Secondary column: Join, What you get, How it runs */}
          <aside className="space-y-4 lg:col-span-4">
            <section className="ui-card p-5">
              <h2 className="text-card-title font-semibold text-ink">
                Join an Existing Room
              </h2>
              <p className="mt-1 text-caption text-ink-muted">
                Already have a 6-character room code? Enter it to join as a
                player or moderator.
              </p>

              <form onSubmit={handleQuickJoin} className="mt-4 space-y-3">
                <div>
                  <label htmlFor="quick-join-code" className="sr-only">
                    Room code
                  </label>
                  <input
                    id="quick-join-code"
                    type="text"
                    maxLength={12}
                    value={joinCodeInput}
                    onChange={(e) =>
                      setJoinCodeInput(e.target.value.toUpperCase())
                    }
                    placeholder="Room code (e.g. K7M9PQ)"
                    className="ui-input font-semibold uppercase tracking-widest placeholder:font-normal placeholder:normal-case placeholder:tracking-normal"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!joinCodeInput.trim()}
                  className="ui-btn-secondary w-full"
                >
                  Continue to Join
                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </form>
            </section>

            <section className="ui-card p-5">
              <h2 className="text-card-title font-semibold text-ink">
                What you get
              </h2>
              <ul className="mt-3 space-y-2.5">
                {WHAT_YOU_GET_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.title} className="flex items-start gap-2.5">
                      <Icon
                        className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                        strokeWidth={1.75}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink">
                          {item.title}
                        </p>
                        <p className="text-caption text-ink-muted">
                          {item.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="ui-card p-5 text-caption text-ink-secondary">
              <h2 className="text-card-title font-semibold text-ink">
                How a Session Runs
              </h2>
              <ol className="mt-2.5 list-decimal space-y-1.5 pl-4">
                <li>Create a room and share the room code with participants.</li>
                <li>
                  Join as a Moderator or Player. Open seats fill with AI
                  personas when started.
                </li>
                <li>
                  Raise your hand to enter the speaking queue and submit points
                  when given the floor.
                </li>
                <li>
                  Review live scores and a full per-participant report when time
                  ends.
                </li>
              </ol>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
