"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { Hand, MicOff, Send, SkipForward } from "lucide-react";
import type { Participant, QueueItem, Speaker } from "@/lib/types";

interface TurnControlsProps {
  you: Participant | null;
  currentSpeaker: Speaker | null;
  queue: QueueItem[];
  disabled: boolean;
  onRaiseHand: () => void;
  onLowerHand: () => void;
  onSubmitTurn: (text: string) => void;
  onYieldTurn: () => void;
}

const MAX_TURN_CHARS = 2000;

export function TurnControls({
  you,
  currentSpeaker,
  queue,
  disabled,
  onRaiseHand,
  onLowerHand,
  onSubmitTurn,
  onYieldTurn,
}: TurnControlsProps) {
  const [text, setText] = useState("");

  if (!you) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        You are viewing this discussion as a read-only spectator.
      </section>
    );
  }

  if (you.role === "moderator") {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        You joined as <span className="font-medium text-slate-900">Moderator</span>. Use the
        Moderator Panel to manage the discussion, skip turns, and adjust scores.
      </section>
    );
  }

  const isMyTurn =
    currentSpeaker !== null && currentSpeaker.participant_id === you.id;
  const myQueueIndex = queue.findIndex((q) => q.participant_id === you.id);
  const isHandRaised = myQueueIndex !== -1;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || !isMyTurn || disabled) return;
    onSubmitTurn(trimmed);
    setText("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section
      className={`rounded-md border bg-white p-4 transition-colors duration-150 ${
        isMyTurn ? "border-blue-800" : "border-slate-200"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              isMyTurn ? "text-blue-800" : "text-slate-900"
            }`}
          >
            {isMyTurn
              ? "Your turn to speak"
              : isHandRaised
              ? `Hand raised — position #${myQueueIndex + 1} in queue`
              : "Your Floor Controls"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isMyTurn ? (
            <button
              type="button"
              onClick={onYieldTurn}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5" strokeWidth={1.75} />
              Yield Turn
            </button>
          ) : isHandRaised ? (
            <button
              type="button"
              onClick={onLowerHand}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Hand className="h-3.5 w-3.5" strokeWidth={1.75} />
              Lower Hand (#{myQueueIndex + 1})
            </button>
          ) : (
            <button
              type="button"
              onClick={onRaiseHand}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded border border-blue-800 bg-blue-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Hand className="h-3.5 w-3.5" strokeWidth={1.75} />
              Raise Hand
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TURN_CHARS))}
          onKeyDown={handleKeyDown}
          disabled={!isMyTurn || disabled}
          rows={3}
          placeholder={
            isMyTurn
              ? "Type your point and press Enter or click Submit Turn..."
              : "Raise your hand and wait for the floor to submit your turn."
          }
          className="w-full resize-none rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {/* Voice input placeholder reserved for Stage 2 (Whisper STT) */}
            <button
              type="button"
              disabled
              aria-label="Voice input coming soon"
              title="Voice input (Whisper STT) will be enabled in Stage 2"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400"
            >
              <MicOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              Voice (Coming Soon)
            </button>
            <span className="text-xs text-slate-400 tabular-nums">
              {text.length}/{MAX_TURN_CHARS}
            </span>
          </div>

          <button
            type="submit"
            disabled={!isMyTurn || disabled || text.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded bg-blue-800 px-4 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
            Submit Turn
          </button>
        </div>
      </form>
    </section>
  );
}

