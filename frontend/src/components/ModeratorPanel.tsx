"use client";

import { useState } from "react";
import {
  Bot,
  Minus,
  Play,
  Plus,
  Shield,
  SkipForward,
  Square,
  UserCheck,
} from "lucide-react";
import { formatScore } from "@/lib/format";
import type {
  Participant,
  Room,
  Speaker,
  TranscriptEntry,
} from "@/lib/types";

interface ModeratorPanelProps {
  room: Room;
  participants: Participant[];
  currentSpeaker: Speaker | null;
  transcript: TranscriptEntry[];
  disabled: boolean;
  onStartGd: () => void;
  onEndGd: () => void;
  onSkipSpeaker: () => void;
  onGrantTurn: (participantId: number) => void;
  onAdjustScore: (participantId: number, delta: number, reason?: string) => void;
}

export function ModeratorPanel({
  room,
  participants,
  currentSpeaker,
  transcript,
  disabled,
  onStartGd,
  onEndGd,
  onSkipSpeaker,
  onGrantTurn,
  onAdjustScore,
}: ModeratorPanelProps) {
  const [activeTab, setActiveTab] = useState<"controls" | "comments">("controls");
  const [reason, setReason] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);

  const players = participants.filter((p) => p.role === "player");
  const scoredTurns = [...transcript]
    .filter((entry) => entry.scores !== null)
    .reverse();

  const handleAdjust = (participantId: number, delta: number) => {
    onAdjustScore(participantId, delta, reason.trim() || undefined);
    setReason("");
  };

  return (
    <section className="rounded-md border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-800" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-slate-900">
            Moderator Panel
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {room.status === "lobby" && (
            <button
              type="button"
              onClick={onStartGd}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded bg-blue-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={2} />
              Start GD
            </button>
          )}

          {room.status === "running" && (
            <>
              {currentSpeaker && (
                <button
                  type="button"
                  onClick={onSkipSpeaker}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <SkipForward className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Skip Speaker
                </button>
              )}

              {!confirmEnd ? (
                <button
                  type="button"
                  onClick={() => setConfirmEnd(true)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square className="h-3 w-3" strokeWidth={2} />
                  End GD
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmEnd(false);
                      onEndGd();
                    }}
                    disabled={disabled}
                    className="rounded bg-red-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-red-800"
                  >
                    Confirm End
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(false)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-slate-200 px-4">
        <button
          type="button"
          onClick={() => setActiveTab("controls")}
          className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors duration-150 ${
            activeTab === "controls"
              ? "border-blue-800 text-blue-800"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Score Adjustments
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("comments")}
          className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors duration-150 ${
            activeTab === "comments"
              ? "border-blue-800 text-blue-800"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Score Comments ({scoredTurns.length})
        </button>
      </div>

      {activeTab === "controls" ? (
        <div className="p-4">
          {room.status !== "running" ? (
            <p className="text-xs text-slate-500">
              Start the discussion to adjust participant scores or grant turns.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="mod-reason"
                  className="mb-1 block text-[11px] font-medium text-slate-600"
                >
                  Optional adjustment note (applied to next +/- click)
                </label>
                <input
                  id="mod-reason"
                  type="text"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Strong summary, Good counterpoint, Interrupted"
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none"
                />
              </div>

              <div className="divide-y divide-slate-100 rounded border border-slate-200">
                {players.map((player) => (
                  <div
                    key={player.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-slate-900">
                        {player.name}
                      </span>
                      {player.is_ai && (
                        <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-600">
                          <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                          AI
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {!currentSpeaker && (
                        <button
                          type="button"
                          onClick={() => onGrantTurn(player.id)}
                          disabled={disabled}
                          title={`Grant floor to ${player.name}`}
                          className="mr-1 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors duration-150 hover:border-blue-800 hover:text-blue-800 disabled:opacity-50"
                        >
                          <UserCheck className="h-3 w-3" strokeWidth={1.75} />
                          Floor
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, -1)}
                        disabled={disabled}
                        title="Subtract 1 point"
                        className="inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Minus className="h-2.5 w-2.5" strokeWidth={2} />1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, -0.5)}
                        disabled={disabled}
                        title="Subtract 0.5 points"
                        className="rounded border border-red-200 bg-white px-1.5 py-1 text-[11px] font-medium text-red-700 transition-colors duration-150 hover:bg-red-50 disabled:opacity-50"
                      >
                        -0.5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, 0.5)}
                        disabled={disabled}
                        title="Add 0.5 points"
                        className="rounded border border-green-200 bg-white px-1.5 py-1 text-[11px] font-medium text-green-700 transition-colors duration-150 hover:bg-green-50 disabled:opacity-50"
                      >
                        +0.5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, 1)}
                        disabled={disabled}
                        title="Add 1 point"
                        className="inline-flex items-center gap-0.5 rounded border border-green-200 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 transition-colors duration-150 hover:bg-green-100 disabled:opacity-50"
                      >
                        <Plus className="h-2.5 w-2.5" strokeWidth={2} />1
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-[280px] space-y-2.5 overflow-y-auto p-4">
          {scoredTurns.length === 0 ? (
            <p className="text-xs text-slate-500">
              AI evaluation comments will appear here after each completed turn.
            </p>
          ) : (
            scoredTurns.map((entry) => (
              <div
                key={entry.turn_id}
                className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {entry.name} · Turn #{entry.seq}
                  </span>
                  <span className="font-semibold text-blue-800 tabular-nums">
                    {formatScore(entry.turn_score)} / 10
                  </span>
                </div>
                {entry.scores && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
                    <span>Rel: {entry.scores.relevance}</span>
                    <span>Cla: {entry.scores.clarity}</span>
                    <span>Con: {entry.scores.content}</span>
                    <span>Team: {entry.scores.teamwork}</span>
                  </div>
                )}
                {entry.comment && (
                  <p className="mt-1.5 text-slate-700">{entry.comment}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

