"use client";

import { useState } from "react";
import { Check, Clock, Copy, Play, Shield, User, Users } from "lucide-react";
import { unlockAudio } from "@/lib/speech";
import type { Participant, Room } from "@/lib/types";

interface LobbyPanelProps {
  room: Room;
  participants: Participant[];
  you: Participant | null;
  disabled: boolean;
  onStartGd: () => void;
}

export function LobbyPanel({
  room,
  participants,
  you,
  disabled,
  onStartGd,
}: LobbyPanelProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const players = participants.filter((p) => p.role === "player");
  const moderator = participants.find((p) => p.role === "moderator") ?? null;
  const openSeats = Math.max(0, room.max_participants - players.length);
  const canStart = Boolean(you?.can_moderate);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  const copyJoinLink = async () => {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(`${origin}/join?code=${room.code}`);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Session Lobby
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {canStart
              ? "Review joined participants and start the discussion when ready."
              : "Waiting for moderator to start the discussion."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50"
          >
            {copiedCode ? (
              <Check className="h-3.5 w-3.5 text-green-700" strokeWidth={2} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Code: <span className="font-semibold tracking-wider">{room.code}</span>
          </button>

          <button
            type="button"
            onClick={copyJoinLink}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50"
          >
            {copiedLink ? (
              <Check className="h-3.5 w-3.5 text-green-700" strokeWidth={2} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {copiedLink ? "Link Copied" : "Copy Join Link"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
              Joined Participants ({participants.length})
            </span>
            <span>
              {players.length}/{room.max_participants} player seats
            </span>
          </div>

          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-slate-50">
            {participants.length === 0 ? (
              <li className="px-3 py-3 text-xs text-slate-500">
                No participants have joined yet.
              </li>
            ) : (
              participants.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        p.connected ? "bg-green-600" : "bg-slate-300"
                      }`}
                    />
                    <span className="font-medium text-slate-900">{p.name}</span>
                    {you?.id === p.id && (
                      <span className="text-xs font-medium text-blue-800">
                        (You)
                      </span>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
                    {p.role === "moderator" ? (
                      <>
                        <Shield className="h-3 w-3 text-blue-800" strokeWidth={1.75} />
                        Moderator
                      </>
                    ) : (
                      <>
                        <User className="h-3 w-3" strokeWidth={1.75} />
                        {p.can_moderate ? "Player (Host)" : "Player"}
                      </>
                    )}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="flex flex-col justify-between rounded border border-slate-200 bg-slate-50 p-4">
          <div className="space-y-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-900">Session Summary</p>
            <p>
              Duration:{" "}
              <span className="font-medium text-slate-800">
                {Math.round(room.duration_seconds / 60)} min
              </span>{" "}
              {room.turn_limit_seconds
                ? `· Turn limit: ${room.turn_limit_seconds}s`
                : "· No per-turn limit"}
            </p>
            <p>
              Moderator:{" "}
              <span className="font-medium text-slate-800">
                {moderator ? moderator.name : "None (first player acts as host)"}
              </span>
            </p>
            {room.fill_with_ai && openSeats > 0 && (
              <p>
                {openSeats} open {openSeats === 1 ? "seat" : "seats"} will be
                filled automatically with distinct AI personas when the
                discussion starts.
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-slate-200 pt-4">
            {canStart ? (
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  onStartGd();
                }}
                disabled={disabled}
                className="inline-flex w-full items-center justify-center gap-2 rounded bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" strokeWidth={2} />
                Start Discussion
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600">
                <Clock className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
                <span>Waiting for moderator to start the GD...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

