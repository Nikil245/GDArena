"use client";

import { Bot, Hand, Mic, PauseCircle, User } from "lucide-react";
import { getInitials } from "@/lib/format";
import type { Participant, QueueItem, Room, Speaker } from "@/lib/types";

interface RoundTable2DProps {
  room: Room;
  participants: Participant[];
  currentSpeaker: Speaker | null;
  ttsSpeakingParticipantId?: number | null;
  aiPaused?: boolean;
  queue: QueueItem[];
  youId: number | null;
}

interface SeatSlot {
  index: number;
  participant: Participant | null;
}

export function RoundTable2D({
  room,
  participants,
  currentSpeaker,
  ttsSpeakingParticipantId = null,
  aiPaused = false,
  queue,
  youId,
}: RoundTable2DProps) {
  const players = participants.filter((p) => p.role === "player");
  const totalSeats = Math.max(room.max_participants, players.length);
  const seats: SeatSlot[] = Array.from({ length: totalSeats }, (_, index) => ({
    index,
    participant: players[index] ?? null,
  }));

  const queuePosition = new Map<number, number>();
  queue.forEach((item, idx) => {
    queuePosition.set(item.participant_id, idx + 1);
  });

  // Elliptical radii keep 2-10 seat cards clearly separated inside the stage.
  const radiusX = totalSeats <= 4 ? 35 : totalSeats <= 6 ? 37 : 38;
  const radiusY = totalSeats <= 4 ? 36 : totalSeats <= 6 ? 38 : 39;

  const renderSeatCard = (slot: SeatSlot, compact: boolean) => {
    const p = slot.participant;
    if (!p) {
      return (
        <div
          className={`flex flex-col items-center justify-center rounded-control border border-dashed border-line-input bg-subtle px-2.5 py-2 text-center ${
            compact
              ? "min-h-[76px] w-full"
              : "min-h-[76px] w-[132px] lg:w-[138px]"
          }`}
        >
          <span className="text-caption font-medium text-ink-muted">
            Seat {slot.index + 1}
          </span>
          <span className="mt-0.5 text-[11px] text-ink-muted">
            {room.fill_with_ai ? "AI on start" : "Open seat"}
          </span>
        </div>
      );
    }

    const isPausedAi = p.is_ai && aiPaused;
    const isThinking =
      !isPausedAi &&
      currentSpeaker?.participant_id === p.id &&
      currentSpeaker?.phase === "thinking";
    const isSpeaking = isPausedAi
      ? false
      : p.is_ai
      ? ttsSpeakingParticipantId === p.id
      : currentSpeaker?.participant_id === p.id;
    const isActiveTurn = isSpeaking || isThinking;
    const qPos = queuePosition.get(p.id);
    const isYou = youId !== null && p.id === youId;

    return (
      <div
        className={`relative rounded-control bg-surface px-2.5 py-2 transition-colors duration-150 sm:px-3 ${
          compact ? "w-full" : "w-[132px] lg:w-[146px]"
        } ${
          isSpeaking
            ? "border-2 border-accent bg-accent-soft"
            : isThinking
            ? "border-2 border-line-strong bg-subtle"
            : "border border-line"
        }`}
        title={
          p.persona
            ? `${p.name} — ${p.persona.label}: ${p.persona.description}`
            : p.name
        }
      >
        {/* Speaking / Thinking solid badge */}
        {isActiveTurn && (
          <span
            className={`absolute -top-2.5 left-2.5 inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${
              isSpeaking ? "bg-accent" : "bg-ink-muted"
            }`}
          >
            <Mic className="h-2.5 w-2.5" strokeWidth={2} />
            {isSpeaking ? "Speaking" : "Thinking"}
          </span>
        )}

        {/* Raised hand badge */}
        {qPos !== undefined && !isActiveTurn && (
          <span
            className="absolute -top-2.5 right-2 inline-flex items-center gap-1 rounded-chip border border-accent-border bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-text"
            title={`Raise-hand queue position #${qPos}`}
          >
            <Hand className="h-2.5 w-2.5" strokeWidth={2} />#{qPos}
          </span>
        )}

        <div className="flex items-center gap-2.5">
          <div
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
              isSpeaking
                ? "border-accent bg-accent text-white"
                : p.is_ai
                ? "border-line-input bg-muted text-ink-secondary"
                : "border-line-input bg-surface text-ink"
            }`}
          >
            {getInitials(p.name)}
            {!p.is_ai && (
              <>
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                    p.connected ? "bg-green-600" : "bg-slate-400"
                  }`}
                  title={p.connected ? "Online" : "Offline"}
                />
                <span className="sr-only">
                  {p.connected ? "Online" : "Offline"}
                </span>
              </>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-xs font-semibold text-ink">
                {p.name}
              </span>
              {isYou && (
                <span className="shrink-0 text-[10px] font-semibold text-accent-text">
                  (You)
                </span>
              )}
            </div>

            <div className="mt-0.5 flex items-center gap-1">
              {p.is_ai ? (
                isPausedAi ? (
                  <span className="inline-flex items-center gap-0.5 rounded-chip border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-900">
                    <PauseCircle className="h-2.5 w-2.5" strokeWidth={1.75} />
                    Paused
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-chip border border-line bg-muted px-1 py-0.5 text-[10px] font-medium text-ink-secondary">
                    <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                    AI
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-ink-muted">
                  <User className="h-2.5 w-2.5" strokeWidth={1.75} />
                  Player
                </span>
              )}
            </div>
          </div>
        </div>

        {p.is_ai && p.persona && (
          <p className="mt-1 truncate text-[10px] text-ink-muted">
            {p.persona.label}
          </p>
        )}
      </div>
    );
  };

  const centerStatus = () => {
    if (room.status === "lobby") {
      return {
        label: "Lobby",
        title: `${players.length} of ${room.max_participants} seats filled`,
        subtitle: room.fill_with_ai
          ? "Remaining seats filled by AI on start"
          : "Waiting for participants",
      };
    }
    if (currentSpeaker) {
      return {
        label:
          currentSpeaker.phase === "thinking"
            ? "Preparing Point"
            : "Current Speaker",
        title: currentSpeaker.name,
        subtitle:
          queue.length > 0
            ? `${queue.length} waiting in queue`
            : "No one else in queue",
      };
    }
    return {
      label: "Floor Open",
      title: "No active speaker",
      subtitle:
        queue.length > 0
          ? `${queue.length} waiting in queue`
          : "Raise your hand to take the floor",
    };
  };

  const center = centerStatus();

  return (
    <>
      {/* Desktop & tablet circular round-table layout */}
      <div className="relative hidden h-[430px] w-full md:block lg:h-[470px]">
        <div className="absolute left-1/2 top-1/2 flex h-[48%] w-[46%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-line bg-subtle px-6 text-center">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            {center.label}
          </span>
          <p className="mt-1 max-w-full truncate text-base font-semibold text-ink">
            {center.title}
          </p>
          <p className="mt-0.5 text-caption text-ink-muted">{center.subtitle}</p>
        </div>

        {seats.map((slot) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * slot.index) / totalSeats;
          const x = 50 + radiusX * Math.cos(angle);
          const y = 50 + radiusY * Math.sin(angle);
          return (
            <div
              key={slot.participant ? slot.participant.id : `empty-${slot.index}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {renderSeatCard(slot, false)}
            </div>
          );
        })}
      </div>

      {/* Mobile stacked fallback */}
      <div className="md:hidden">
        <div className="ui-card-subtle mb-3 px-3 py-2.5 text-center">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            {center.label}
          </span>
          <p className="text-sm font-semibold text-ink">{center.title}</p>
          <p className="text-caption text-ink-muted">{center.subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5 pt-2">
          {seats.map((slot) => (
            <div
              key={
                slot.participant ? slot.participant.id : `m-empty-${slot.index}`
              }
              className="min-w-0"
            >
              {renderSeatCard(slot, true)}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
