"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Clock,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ApiError, createRoom } from "@/lib/api";
import type { TopicCategory } from "@/lib/types";

const PARTICIPANT_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const CATEGORY_OPTIONS: { value: "" | TopicCategory; label: string }[] = [
  { value: "", label: "Any category" },
  { value: "current_affairs", label: "Current Affairs" },
  { value: "business", label: "Business & Economy" },
  { value: "social", label: "Social Issues" },
  { value: "abstract", label: "Abstract" },
];

export default function HomePage() {
  const router = useRouter();

  const [topicMode, setTopicMode] = useState<"custom" | "moderator">("moderator");
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
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0.5 || parsedMinutes > 60) {
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
    <div className="min-h-screen bg-slate-50">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Group Discussion Practice
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-600">
            Configure a structured practice room with a live moderator, server-synced
            timer, AI participants, and per-turn evaluation.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          {/* Setup Form */}
          <section className="rounded-md border border-slate-200 bg-white p-6 lg:col-span-8">
            <div className="mb-5 border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">
                Create a Discussion Room
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Empty seats are automatically filled by distinct AI personas when
                the moderator starts the session.
              </p>
            </div>

            {error && (
              <div className="mb-5 flex items-start gap-2.5 rounded border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
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
                <label className="mb-2 block text-sm font-medium text-slate-800">
                  Discussion Topic
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setTopicMode("moderator")}
                    className={`rounded border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${
                      topicMode === "moderator"
                        ? "border-blue-800 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <span className="block font-medium">
                      Let moderator choose
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Random pick from topic bank
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTopicMode("custom")}
                    className={`rounded border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ${
                      topicMode === "custom"
                        ? "border-blue-800 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <span className="block font-medium">Custom topic</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Enter your own prompt
                    </span>
                  </button>
                </div>

                {topicMode === "custom" ? (
                  <div className="mt-3">
                    <input
                      type="text"
                      maxLength={300}
                      value={topicText}
                      onChange={(e) => setTopicText(e.target.value)}
                      placeholder="e.g., Should companies adopt a four-day work week?"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="mt-3">
                    <label
                      htmlFor="topic-category"
                      className="mb-1 block text-xs font-medium text-slate-600"
                    >
                      Topic category (optional)
                    </label>
                    <select
                      id="topic-category"
                      value={topicCategory}
                      onChange={(e) =>
                        setTopicCategory(e.target.value as "" | TopicCategory)
                      }
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value || "any"} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Participants Selector */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    <Users className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                    Participants
                  </label>
                  <span className="text-xs font-medium text-slate-500">
                    {maxParticipants} seats (human + AI)
                  </span>
                </div>
                <div className="grid grid-cols-9 gap-1.5">
                  {PARTICIPANT_OPTIONS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setMaxParticipants(count)}
                      className={`rounded border py-2 text-sm font-medium tabular-nums transition-colors duration-150 ${
                        maxParticipants === count
                          ? "border-blue-800 bg-blue-800 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration & Optional Turn Limit */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="duration-minutes"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800"
                  >
                    <Clock className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
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
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-800 focus:outline-none"
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    {[5, 10, 15, 20].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDurationMinutes(String(m))}
                        className={`rounded border px-2 py-0.5 text-xs transition-colors duration-150 ${
                          Number(durationMinutes) === m
                            ? "border-blue-800 bg-blue-50 font-medium text-blue-900"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="turn-limit-toggle"
                      className="flex items-center gap-1.5 text-sm font-medium text-slate-800"
                    >
                      <SlidersHorizontal
                        className="h-4 w-4 text-slate-500"
                        strokeWidth={1.75}
                      />
                      Per-turn limit
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                      <input
                        id="turn-limit-toggle"
                        type="checkbox"
                        checked={turnLimitEnabled}
                        onChange={(e) => setTurnLimitEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-800 focus:ring-blue-800"
                      />
                      {turnLimitEnabled ? "Enabled" : "Off"}
                    </label>
                  </div>

                  <input
                    type="number"
                    min={10}
                    max={600}
                    step={5}
                    disabled={!turnLimitEnabled}
                    value={turnLimitSeconds}
                    onChange={(e) => setTurnLimitSeconds(e.target.value)}
                    placeholder="Seconds per turn"
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-800 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {turnLimitEnabled
                      ? "10 to 600 seconds per speaker turn."
                      : "Optional cap on how long each speaker can hold the floor."}
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded bg-blue-800 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {submitting ? "Creating Room..." : "Create Room"}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </form>
          </section>

          {/* Secondary card: Join Existing Room */}
          <aside className="space-y-4 lg:col-span-4">
            <section className="rounded-md border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Join an Existing Room
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Already have a 6-character room code? Enter it to join as a
                player or moderator.
              </p>

              <form onSubmit={handleQuickJoin} className="mt-4 space-y-3">
                <input
                  type="text"
                  maxLength={12}
                  value={joinCodeInput}
                  onChange={(e) =>
                    setJoinCodeInput(e.target.value.toUpperCase())
                  }
                  placeholder="Room code (e.g. K7M9PQ)"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium uppercase tracking-wider text-slate-900 placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!joinCodeInput.trim()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue to Join
                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </form>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-5 text-xs text-slate-600">
              <h3 className="font-semibold text-slate-900">How a Session Runs</h3>
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

