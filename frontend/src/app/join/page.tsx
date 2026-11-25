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
import { ApiError, fetchRoom, joinRoom } from "@/lib/api";
import { loadSavedName, saveRoomSession } from "@/lib/storage";
import type { Role, Room } from "@/lib/types";

function JoinRoomContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialCode = (searchParams.get("code") ?? "").trim().toUpperCase();
  const isNewlyCreated = searchParams.get("created") === "1";

  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(isNewlyCreated ? "moderator" : "player");

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
    if (isModeratorTaken && role === "moderator" && !isRoomFull && !isAlreadyStarted) {
      setRole("player");
    } else if ((isRoomFull || isAlreadyStarted) && role === "player" && !isModeratorTaken) {
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
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      {isNewlyCreated && initialCode && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" strokeWidth={1.75} />
            <span>
              Room <strong className="tracking-wider">{initialCode}</strong>{" "}
              created. Share this code with participants.
            </span>
          </div>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-1 rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-900 transition-colors duration-150 hover:bg-green-100"
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

      <section className="rounded-md border border-slate-200 bg-white p-6">
        <div className="mb-5 border-b border-slate-200 pb-3">
          <h1 className="text-lg font-semibold text-slate-900">
            Join Discussion Room
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Enter the room code, your display name, and select your role.
          </p>
        </div>

        {submitError && (
          <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
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
              className="mb-1.5 block text-sm font-medium text-slate-800"
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
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold uppercase tracking-widest text-slate-900 placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
            />

            {previewLoading && (
              <p className="mt-1.5 text-xs text-slate-500">Checking room...</p>
            )}
            {previewError && (
              <p className="mt-1.5 text-xs font-medium text-red-700">
                {previewError}
              </p>
            )}
            {roomPreview && (
              <div className="mt-2.5 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-medium text-slate-900">
                  {roomPreview.topic}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                  <span>Status: {roomPreview.status}</span>
                  <span>
                    Seats: {roomPreview.seats_taken}/{roomPreview.max_participants}
                  </span>
                  <span>
                    Duration: {Math.round(roomPreview.duration_seconds / 60)} min
                  </span>
                </div>
                {isFinished && (
                  <p className="mt-1.5 font-medium text-red-700">
                    This discussion has already finished.{" "}
                    <Link
                      href={`/room/${encodeURIComponent(roomPreview.code)}`}
                      className="underline"
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
              className="mb-1.5 block text-sm font-medium text-slate-800"
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
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-800">
              Role
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole("player")}
                disabled={isRoomFull || isAlreadyStarted || isFinished}
                className={`rounded border p-3.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  role === "player"
                    ? "border-blue-800 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <User className="h-4 w-4" strokeWidth={1.75} />
                  Player
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {isRoomFull
                    ? "All player seats are full."
                    : isAlreadyStarted
                    ? "Discussion already started."
                    : "Take a seat, raise hand, and get scored."}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setRole("moderator")}
                disabled={isModeratorTaken || isFinished}
                className={`rounded border p-3.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  role === "moderator"
                    ? "border-blue-800 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Shield className="h-4 w-4" strokeWidth={1.75} />
                  Moderator
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {isModeratorTaken
                    ? "A moderator has already joined."
                    : "Start/end session, adjust scores, view comments."}
                </p>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <Link
              href="/"
              className="text-sm font-medium text-slate-600 transition-colors duration-150 hover:text-slate-900"
            >
              Back to setup
            </Link>

            <button
              type="submit"
              disabled={submitting || isFinished || Boolean(previewError)}
              className="inline-flex items-center gap-2 rounded bg-blue-800 px-5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Joining..." : "Join Room"}
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function JoinPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <Suspense
        fallback={
          <main className="mx-auto max-w-xl px-4 py-12 text-sm text-slate-500">
            Loading join form...
          </main>
        }
      >
        <JoinRoomContent />
      </Suspense>
    </div>
  );
}
