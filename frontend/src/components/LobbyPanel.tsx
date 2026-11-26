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
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(`${origin}/join?code=${room.code}`);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <section className="ui-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 border-b border-line-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-section-title font-semibold text-ink">
            Session Lobby
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {canStart
              ? "Review joined participants and start the discussion when ready."
              : "Waiting for moderator to start the discussion."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCode}
            className="ui-btn-secondary min-h-[38px] px-3 py-1.5 text-xs sm:min-h-[36px]"
          >
            {copiedCode ? (
              <Check className="h-3.5 w-3.5 text-success-text" strokeWidth={2} />
            ) : (
              <Copy className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
            )}
            Code:{" "}
            <span className="font-semibold tracking-wider">{room.code}</span>
          </button>

          <button
            type="button"
            onClick={copyJoinLink}
            className="ui-btn-secondary min-h-[38px] px-3 py-1.5 text-xs sm:min-h-[36px]"
          >
            {copiedLink ? (
              <Check className="h-3.5 w-3.5 text-success-text" strokeWidth={2} />
            ) : (
              <Copy className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
            )}
            {copiedLink ? "Link Copied" : "Copy Join Link"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-caption font-medium uppercase tracking-wider text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
              Joined Participants ({participants.length})
            </span>
            <span>
              {players.length}/{room.max_participants} player seats
            </span>
          </div>

          <ul className="divide-y divide-line-subtle rounded-control border border-line bg-subtle">
            {participants.length === 0 ? (
              <li className="px-3 py-3 text-caption text-ink-muted">
                No participants have joined yet.
              </li>
            ) : (
              participants.map((p) => (
                <li
                  key={p.id}
                  className="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        p.connected ? "bg-green-600" : "bg-slate-400"
                      }`}
                    />
                    <span className="sr-only">
                      {p.connected ? "Connected" : "Offline"}
                    </span>
                    <span className="truncate font-medium text-ink">
                      {p.name}
                    </span>
                    {you?.id === p.id && (
                      <span className="shrink-0 text-caption font-semibold text-accent-text">
                        (You)
                      </span>
                    )}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-line bg-surface px-2 py-0.5 text-caption font-medium text-ink-secondary">
                    {p.role === "moderator" ? (
                      <>
                        <Shield
                          className="h-3 w-3 text-accent"
                          strokeWidth={1.75}
                        />
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

        <div className="ui-card-subtle flex flex-col justify-between p-4">
          <div className="space-y-2 text-caption text-ink-muted">
            <p className="text-sm font-semibold text-ink">Session Summary</p>
            <p>
              Duration:{" "}
              <span className="font-semibold text-ink">
                {Math.round(room.duration_seconds / 60)} min
              </span>{" "}
              {room.turn_limit_seconds
                ? `· Turn limit: ${room.turn_limit_seconds}s`
                : "· No per-turn limit"}
            </p>
            <p>
              Moderator:{" "}
              <span className="font-semibold text-ink">
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

          <div className="mt-4 border-t border-line-subtle pt-4">
            {canStart ? (
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  onStartGd();
                }}
                disabled={disabled}
                className="ui-btn-primary h-11 w-full"
              >
                <Play className="h-4 w-4" strokeWidth={2} />
                Start Discussion
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2.5 text-caption font-medium text-ink-muted">
                <Clock className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>Waiting for moderator to start the GD...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
