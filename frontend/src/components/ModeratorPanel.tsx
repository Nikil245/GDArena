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
import { unlockAudio } from "@/lib/speech";
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
  const [activeTab, setActiveTab] = useState<"controls" | "comments">(
    "controls"
  );
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
    <section className="ui-card border-line-strong">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle bg-subtle px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Shield className="h-4 w-4 text-accent" strokeWidth={1.75} />
          <h2 className="text-card-title font-semibold text-ink">
            Moderator Panel
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {room.status === "lobby" && (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                onStartGd();
              }}
              disabled={disabled}
              className="ui-btn-primary min-h-[36px] px-3 py-1.5 text-xs"
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
                  className="ui-btn-secondary min-h-[36px] px-2.5 py-1.5 text-xs"
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
                  className="ui-btn-destructive min-h-[36px] px-2.5 py-1.5 text-xs"
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
                    className="ui-btn-destructive-solid min-h-[36px] px-2.5 py-1.5 text-xs"
                  >
                    Confirm End
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(false)}
                    className="ui-btn-secondary min-h-[36px] px-2.5 py-1.5 text-xs"
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
      <div
        role="tablist"
        aria-label="Moderator sections"
        className="flex overflow-x-auto border-b border-line-subtle px-4"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "controls"}
          onClick={() => setActiveTab("controls")}
          className={`ui-focus -mb-px min-h-[40px] whitespace-nowrap border-b-2 px-3 py-2 text-caption font-medium transition-colors duration-150 ${
            activeTab === "controls"
              ? "border-accent font-semibold text-accent-text"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          Score Adjustments
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "comments"}
          onClick={() => setActiveTab("comments")}
          className={`ui-focus -mb-px min-h-[40px] whitespace-nowrap border-b-2 px-3 py-2 text-caption font-medium transition-colors duration-150 ${
            activeTab === "comments"
              ? "border-accent font-semibold text-accent-text"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          Score Comments ({scoredTurns.length})
        </button>
      </div>

      {activeTab === "controls" ? (
        <div className="p-4">
          {room.status !== "running" ? (
            <p className="text-caption text-ink-muted">
              Start the discussion to adjust participant scores or grant turns.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="mod-reason"
                  className="mb-1.5 block text-caption font-medium text-ink-secondary"
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
                  className="ui-input h-9 text-xs"
                />
              </div>

              <div className="divide-y divide-line-subtle rounded-control border border-line">
                {players.map((player) => (
                  <div
                    key={player.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-caption font-medium text-ink">
                        {player.name}
                      </span>
                      {player.is_ai && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-chip border border-line bg-muted px-1 py-0.5 text-[10px] font-medium text-ink-secondary">
                          <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                          AI
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {!currentSpeaker && (
                        <button
                          type="button"
                          onClick={() => onGrantTurn(player.id)}
                          disabled={disabled}
                          title={`Grant floor to ${player.name}`}
                          className="ui-focus mr-0.5 inline-flex min-h-[36px] items-center gap-1 rounded-chip border border-line-input bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition-colors duration-150 hover:border-accent hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[30px] sm:px-2"
                        >
                          <UserCheck className="h-3 w-3" strokeWidth={1.75} />
                          Floor
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, -1)}
                        disabled={disabled}
                        title={`Subtract 1 point from ${player.name}`}
                        className="ui-focus inline-flex min-h-[36px] items-center gap-0.5 rounded-chip border border-danger-border bg-danger-bg px-2.5 py-1 text-[11px] font-semibold text-danger-text transition-colors duration-150 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[30px] sm:px-2"
                      >
                        <Minus className="h-2.5 w-2.5" strokeWidth={2} />1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, -0.5)}
                        disabled={disabled}
                        title={`Subtract 0.5 points from ${player.name}`}
                        className="ui-focus min-h-[36px] rounded-chip border border-danger-border bg-surface px-2 py-1 text-[11px] font-medium text-danger-text transition-colors duration-150 hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[30px] sm:px-1.5"
                      >
                        -0.5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, 0.5)}
                        disabled={disabled}
                        title={`Add 0.5 points to ${player.name}`}
                        className="ui-focus min-h-[36px] rounded-chip border border-success-border bg-surface px-2 py-1 text-[11px] font-medium text-success-text transition-colors duration-150 hover:bg-success-bg disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[30px] sm:px-1.5"
                      >
                        +0.5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjust(player.id, 1)}
                        disabled={disabled}
                        title={`Add 1 point to ${player.name}`}
                        className="ui-focus inline-flex min-h-[36px] items-center gap-0.5 rounded-chip border border-success-border bg-success-bg px-2.5 py-1 text-[11px] font-semibold text-success-text transition-colors duration-150 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[30px] sm:px-2"
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
            <p className="text-caption text-ink-muted">
              AI evaluation comments will appear here after each completed turn.
            </p>
          ) : (
            scoredTurns.map((entry) => (
              <div
                key={entry.turn_id}
                className="ui-card-subtle p-2.5 text-caption"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {entry.name} · Turn #{entry.seq}
                  </span>
                  <span className="font-semibold text-accent-text tabular-nums">
                    {formatScore(entry.turn_score)} / 10
                  </span>
                </div>
                {entry.scores && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-muted tabular-nums">
                    <span>Rel: {entry.scores.relevance}</span>
                    <span>Cla: {entry.scores.clarity}</span>
                    <span>Con: {entry.scores.content}</span>
                    <span>Team: {entry.scores.teamwork}</span>
                  </div>
                )}
                {entry.comment && (
                  <p className="mt-1.5 text-ink-secondary">{entry.comment}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
