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
    <section className="rounded-md border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className="inline-flex items-center gap-1 uppercase tracking-wider text-slate-500">
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              Discussion Topic
            </span>
            {room.topic_source === "bank" ? (
              <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-700">
                {formatCategory(room.topic_category)}
              </span>
            ) : (
              <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-700">
                Custom Topic
              </span>
            )}
          </div>
          <h1 className="text-lg font-semibold leading-snug text-slate-900 sm:text-xl">
            {room.topic}
          </h1>
        </div>

        <div className="flex shrink-0 flex-wrap items-stretch gap-3">
          {timer.turn_limit_seconds !== null && (
            <div
              className={`flex min-w-[118px] flex-col justify-center rounded-md border px-3.5 py-2 ${
                isLowTurn
                  ? "border-red-300 bg-red-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <Timer className="h-3 w-3" strokeWidth={1.75} />
                Turn Limit
              </span>
              <span
                className={`mt-0.5 text-2xl font-semibold leading-none tabular-nums ${
                  isLowTurn ? "text-red-700" : "text-slate-900"
                }`}
              >
                {currentSpeaker && timer.turn_remaining_seconds !== null
                  ? formatSeconds(timer.turn_remaining_seconds)
                  : formatSeconds(timer.turn_limit_seconds)}
              </span>
            </div>
          )}

          <div
            className={`flex min-w-[144px] flex-col justify-center rounded-md border px-4 py-2 ${
              isLowTime
                ? "border-red-300 bg-red-50"
                : "border-slate-300 bg-slate-50"
            }`}
          >
            <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              {room.status === "lobby"
                ? "Session Length"
                : room.status === "finished"
                ? "Time Remaining"
                : "Time Left"}
            </span>
            <span
              className={`mt-0.5 text-3xl font-semibold leading-none tabular-nums ${
                isLowTime ? "text-red-700" : "text-slate-900"
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

