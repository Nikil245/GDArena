"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Shield,
  User,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { MicCheck } from "@/components/join/MicCheck";
import { TablePreview } from "@/components/join/TablePreview";
import { TipsCard } from "@/components/join/TipsCard";
import { ApiError, fetchRoom, joinRoom } from "@/lib/api";
import { unlockAudio } from "@/lib/speech";
import { loadSavedName, saveRoomSession } from "@/lib/storage";
import type { Role, Room } from "@/lib/types";

function JoinRoomContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialCode = (searchParams.get("code") ?? "").trim().toUpperCase();
  const isNewlyCreated = searchParams.get("created") === "1";

  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("player");

  const [roomPreview, setRoomPreview] = useState<Room | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    const saved = loadSavedName();
    if (saved) {
      setName((prev) => prev || saved);
    }
  }, []);

  useEffect(() => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setRoomPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const snap = await fetchRoom(trimmed);
        if (cancelled) return;
        setRoomPreview(snap.room);
      } catch (err) {
        if (cancelled) return;
        setRoomPreview(null);
        if (err instanceof ApiError) {
          setPreviewError(err.message);
        } else {
          setPreviewError("Could not look up room.");
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  const isRoomFull =
    roomPreview !== null &&
    roomPreview.seats_taken >= roomPreview.max_participants;
  const isModeratorTaken = Boolean(roomPreview?.has_moderator);
  const isFinished = roomPreview?.status === "finished";
  const isAlreadyStarted = roomPreview?.status === "running";

  useEffect(() => {
    if (!roomPreview) return;
    if (
      isModeratorTaken &&
      role === "moderator" &&
      !isRoomFull &&
      !isAlreadyStarted
    ) {
      setRole("player");
    } else if (
      (isRoomFull || isAlreadyStarted) &&
      role === "player" &&
      !isModeratorTaken
    ) {
      setRole("moderator");
    }
  }, [roomPreview, isModeratorTaken, isRoomFull, isAlreadyStarted, role]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code.trim().toUpperCase());
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    setSubmitError(null);

    const cleanedCode = code.trim().toUpperCase();
    const cleanedName = name.trim();

    if (!cleanedCode) {
      setSubmitError("Enter a room code.");
      return;
    }
    if (!cleanedName) {
      setSubmitError("Enter your name.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await joinRoom(cleanedCode, {
        name: cleanedName,
        role,
      });

      saveRoomSession({
        roomCode: res.room.code,
        participantId: res.participant.id,
        name: res.participant.name,
        role: res.participant.role,
        token: res.token,
      });

      router.push(`/room/${encodeURIComponent(res.room.code)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Unable to join the room. Please try again.");
      }
      setSubmitting(false);
    }
  };

  return (
    <main className="app-container py-6 sm:py-10">
      {isNewlyCreated && initialCode && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-control border border-success-border bg-success-bg px-4 py-3 text-sm text-success-text"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-success-text"
              strokeWidth={1.75}
            />
            <span>
              Room <strong className="tracking-wider">{initialCode}</strong>{" "}
              created. Share this code with participants.
            </span>
          </div>
          <button
            type="button"
            onClick={copyCode}
            className="ui-focus inline-flex min-h-[36px] items-center gap-1.5 rounded-chip border border-success-border bg-surface px-2.5 py-1 text-xs font-medium text-success-text transition-colors duration-150 hover:bg-green-100"
          >
            {copiedCode ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {copiedCode ? "Copied" : "Copy Code"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]">
        <section className="ui-card min-w-0 p-5 sm:p-6">
          <div className="mb-5 border-b border-line-subtle pb-3.5">
            <h1 className="text-lg font-semibold text-ink sm:text-xl">
              Join Discussion Room
            </h1>
            <p className="mt-0.5 text-caption text-ink-muted">
              Enter the room code, your display name, and select your role.
            </p>
          </div>

          {submitError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-control border border-danger-border bg-danger-bg px-3.5 py-2.5 text-sm text-danger-text"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0"
                strokeWidth={1.75}
              />
              <span>{submitError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="room-code"
                className="mb-1.5 block text-sm font-medium text-ink"
              >
                Room Code
              </label>
              <input
                id="room-code"
                type="text"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7M9PQ"
                className="ui-input font-semibold uppercase tracking-widest placeholder:font-normal placeholder:normal-case placeholder:tracking-normal"
              />

              {previewLoading && (
                <p className="mt-1.5 text-caption text-ink-muted">
                  Checking room...
                </p>
              )}
              {previewError && (
                <p
                  role="alert"
                  className="mt-1.5 text-caption font-medium text-danger-text"
                >
                  {previewError}
                </p>
              )}
              {roomPreview && (
                <div className="ui-card-subtle mt-2.5 p-3 text-caption text-ink-secondary">
                  <p className="font-semibold text-ink">{roomPreview.topic}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
                    <span>Status: {roomPreview.status}</span>
                    <span>
                      Seats: {roomPreview.seats_taken}/
                      {roomPreview.max_participants}
                    </span>
                    <span>
                      Duration: {Math.round(roomPreview.duration_seconds / 60)}{" "}
                      min
                    </span>
                  </div>
                  {isFinished && (
                    <p className="mt-1.5 font-medium text-danger-text">
                      This discussion has already finished.{" "}
                      <Link
                        href={`/room/${encodeURIComponent(roomPreview.code)}`}
                        className="ui-focus underline"
                      >
                        View results
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="display-name"
                className="mb-1.5 block text-sm font-medium text-ink"
              >
                Your Name
              </label>
              <input
                id="display-name"
                type="text"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="ui-input"
              />
            </div>

            <div>
              <span
                id="role-label"
                className="mb-2 block text-sm font-medium text-ink"
              >
                Role
              </span>
              <div
                role="group"
                aria-labelledby="role-label"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <button
                  type="button"
                  aria-pressed={role === "player"}
                  onClick={() => setRole("player")}
                  disabled={isRoomFull || isAlreadyStarted || isFinished}
                  className={`ui-focus rounded-control p-3.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    role === "player"
                      ? "border-2 border-accent bg-accent-soft text-accent-text"
                      : "border border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <User className="h-4 w-4" strokeWidth={1.75} />
                    Player
                  </div>
                  <p className="mt-1 text-caption text-ink-muted">
                    {isRoomFull
                      ? "All player seats are full."
                      : isAlreadyStarted
                      ? "Discussion already started."
                      : "Speak with AI peers. First player acts as host if no moderator joins."}
                  </p>
                </button>

                <button
                  type="button"
                  aria-pressed={role === "moderator"}
                  onClick={() => setRole("moderator")}
                  disabled={isModeratorTaken || isFinished}
                  className={`ui-focus rounded-control p-3.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    role === "moderator"
                      ? "border-2 border-accent bg-accent-soft text-accent-text"
                      : "border border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Shield className="h-4 w-4" strokeWidth={1.75} />
                    Moderator
                  </div>
                  <p className="mt-1 text-caption text-ink-muted">
                    {isModeratorTaken
                      ? "A moderator has already joined."
                      : "Start/end session, adjust scores, view comments."}
                  </p>
                </button>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-line-subtle pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Link href="/" className="ui-btn-secondary w-full sm:w-auto">
                Back to setup
              </Link>

              <button
                type="submit"
                disabled={submitting || isFinished || Boolean(previewError)}
                className="ui-btn-primary h-11 w-full px-6 sm:w-auto"
              >
                {submitting ? "Joining..." : "Join Room"}
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </form>
        </section>

        <aside
          aria-label="Room preview and preparation"
          className="min-w-0 space-y-4"
        >
          <div className="hidden md:block">
            <TablePreview room={roomPreview} />
          </div>
          <MicCheck />
          <TipsCard />
        </aside>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <div className="min-h-screen bg-page">
      <AppHeader />
      <Suspense
        fallback={
          <main className="app-container py-6 sm:py-10">
            <div className="ui-card max-w-xl p-6 text-sm text-ink-muted">
              Loading join form...
            </div>
          </main>
        }
      >
        <JoinRoomContent />
      </Suspense>
    </div>
  );
}
