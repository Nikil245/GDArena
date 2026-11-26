"use client";

import { Clock, MessageSquare, Timer } from "lucide-react";
import { formatCategory, formatSeconds } from "@/lib/format";
import type { Room, Speaker, TimerState } from "@/lib/types";

interface TimerBannerProps {
  room: Room;
  timer: TimerState;
  currentSpeaker: Speaker | null;
}

export function TimerBanner({
  room,
  timer,
  currentSpeaker,
}: TimerBannerProps) {
  const isLowTime =
    room.status === "running" && timer.remaining_seconds <= 60;
  const isLowTurn =
    room.status === "running" &&
    timer.turn_remaining_seconds !== null &&
    timer.turn_remaining_seconds <= 10;

  return (
    <section className="ui-card p-4 sm:p-5">
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-ink-muted">
            <span className="inline-flex items-center gap-1 uppercase tracking-wider">
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              Discussion Topic
            </span>
            {room.topic_source === "bank" ? (
              <span className="rounded-chip border border-line bg-muted px-2 py-0.5 text-ink-secondary">
                {formatCategory(room.topic_category)}
              </span>
            ) : (
              <span className="rounded-chip border border-line bg-muted px-2 py-0.5 text-ink-secondary">
                Custom Topic
              </span>
            )}
          </div>
          <h1 className="break-words text-lg font-semibold leading-snug text-ink sm:text-xl">
            {room.topic}
          </h1>
        </div>

        <div className="flex w-full shrink-0 items-stretch gap-2.5 sm:w-auto sm:gap-3">
          {(timer.turn_limit_seconds !== null ||
            (currentSpeaker !== null &&
              timer.turn_remaining_seconds !== null)) && (
            <div
              className={`flex min-w-0 flex-1 flex-col justify-center rounded-control border px-3 py-2 sm:min-w-[122px] sm:flex-none sm:px-3.5 ${
                isLowTurn
                  ? "border-danger-border bg-danger-bg"
                  : "border-line-subtle bg-subtle"
              }`}
            >
              <span
                className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider ${
                  isLowTurn ? "text-danger-text" : "text-ink-muted"
                }`}
              >
                <Timer className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                <span className="truncate">Turn Limit</span>
              </span>
              <span
                className={`mt-0.5 text-xl font-semibold leading-none tabular-nums sm:text-2xl ${
                  isLowTurn ? "text-danger-text" : "text-ink"
                }`}
              >
                {currentSpeaker && timer.turn_remaining_seconds !== null
                  ? formatSeconds(timer.turn_remaining_seconds)
                  : formatSeconds(timer.turn_limit_seconds ?? 60)}
              </span>
            </div>
          )}

          <div
            className={`flex min-w-0 flex-1 flex-col justify-center rounded-control border px-3 py-2 sm:min-w-[144px] sm:flex-none sm:px-4 ${
              isLowTime
                ? "border-danger-border bg-danger-bg"
                : "border-line bg-subtle"
            }`}
          >
            <span
              className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider ${
                isLowTime ? "text-danger-text" : "text-ink-muted"
              }`}
            >
              <Clock className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">
                {room.status === "lobby"
                  ? "Session Length"
                  : room.status === "finished"
                  ? "Time Remaining"
                  : "Time Left"}
              </span>
            </span>
            <span
              className={`mt-0.5 text-2xl font-semibold leading-none tabular-nums sm:text-3xl ${
                isLowTime ? "text-danger-text" : "text-ink"
              }`}
            >
              {formatSeconds(timer.remaining_seconds)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
