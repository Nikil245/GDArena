"use client";

import { Bot, Hand, Mic, User } from "lucide-react";
import { getInitials } from "@/lib/format";
import type { Participant, QueueItem, Room, Speaker } from "@/lib/types";

interface RoundTableProps {
  room: Room;
  participants: Participant[];
  currentSpeaker: Speaker | null;
  ttsSpeakingParticipantId?: number | null;
  queue: QueueItem[];
  youId: number | null;
}

interface SeatSlot {
  index: number;
  participant: Participant | null;
}

export function RoundTable({
  room,
  participants,
  currentSpeaker,
  ttsSpeakingParticipantId = null,
  queue,
  youId,
}: RoundTableProps) {
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
  const radiusX = totalSeats <= 4 ? 36 : totalSeats <= 6 ? 39 : 41;
  const radiusY = totalSeats <= 4 ? 36 : totalSeats <= 6 ? 38 : 39;

  const renderSeatCard = (slot: SeatSlot, compact: boolean) => {
    const p = slot.participant;
    if (!p) {
      return (
        <div
          className={`flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-2.5 py-2 text-center ${
            compact ? "w-full min-h-[76px]" : "w-[138px] min-h-[76px]"
          }`}
        >
          <span className="text-xs font-medium text-slate-400">
            Seat {slot.index + 1}
          </span>
          <span className="mt-0.5 text-[11px] text-slate-400">
            {room.fill_with_ai ? "AI on start" : "Open seat"}
          </span>
        </div>
      );
    }

    const isSpeaking =
      currentSpeaker?.participant_id === p.id ||
      ttsSpeakingParticipantId === p.id;
    const isThinking =
      currentSpeaker?.participant_id === p.id &&
      currentSpeaker?.phase === "thinking";
    const qPos = queuePosition.get(p.id);
    const isYou = youId !== null && p.id === youId;

    return (
      <div
        className={`relative rounded-md bg-white px-3 py-2 transition-colors duration-150 ${
          compact ? "w-full" : "w-[146px]"
        } ${
          isSpeaking
            ? "border-2 border-blue-800 bg-blue-50"
            : "border border-slate-200"
        }`}
        title={
          p.persona
            ? `${p.name} — ${p.persona.label}: ${p.persona.description}`
            : p.name
        }
      >
        {/* Speaking / Thinking solid badge */}
        {isSpeaking && (
          <span className="absolute -top-2.5 left-2.5 inline-flex items-center gap-1 rounded bg-blue-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            <Mic className="h-2.5 w-2.5" strokeWidth={2} />
            {isThinking ? "Thinking" : "Speaking"}
          </span>
        )}

        {/* Raised hand badge */}
        {qPos !== undefined && !isSpeaking && (
          <span
            className="absolute -top-2.5 right-2 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
            title={`Raise-hand queue position #${qPos}`}
          >
            <Hand className="h-2.5 w-2.5" strokeWidth={2} />#{qPos}
          </span>
        )}

        <div className="flex items-center gap-2.5">
          <div
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
              isSpeaking
                ? "border-blue-800 bg-blue-800 text-white"
                : p.is_ai
                ? "border-slate-300 bg-slate-100 text-slate-700"
                : "border-slate-300 bg-white text-slate-800"
            }`}
          >
            {getInitials(p.name)}
            {!p.is_ai && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                  p.connected ? "bg-green-600" : "bg-slate-300"
                }`}
                title={p.connected ? "Online" : "Offline"}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-xs font-semibold text-slate-900">
                {p.name}
              </span>
              {isYou && (
                <span className="shrink-0 text-[10px] font-medium text-blue-800">
                  (You)
                </span>
              )}
            </div>

            <div className="mt-0.5 flex items-center gap-1">
              {p.is_ai ? (
                <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                  AI
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                  <User className="h-2.5 w-2.5" strokeWidth={1.75} />
                  Player
                </span>
              )}
            </div>
          </div>
        </div>

        {p.is_ai && p.persona && (
          <p className="mt-1 truncate text-[10px] text-slate-500">
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
        label: currentSpeaker.phase === "thinking" ? "Preparing Point" : "Current Speaker",
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
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <h2 className="text-sm font-semibold text-slate-900">
          Discussion Table
        </h2>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            {players.length}/{room.max_participants} seats
          </span>
          {queue.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-900">
              <Hand className="h-3 w-3" strokeWidth={1.75} />
              Queue: {queue.map((q) => q.name).join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Desktop & tablet circular round-table layout */}
      <div className="relative hidden h-[440px] w-full sm:block lg:h-[470px]">
        {/* Central table ring */}
        <div className="absolute left-1/2 top-1/2 flex h-[48%] w-[46%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-6 text-center">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {center.label}
          </span>
          <p className="mt-1 max-w-full truncate text-base font-semibold text-slate-900">
            {center.title}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{center.subtitle}</p>
        </div>

        {/* Seats arranged in a circle */}
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
      <div className="sm:hidden">
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {center.label}
          </span>
          <p className="text-sm font-semibold text-slate-900">{center.title}</p>
          <p className="text-xs text-slate-500">{center.subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {seats.map((slot) => (
            <div
              key={slot.participant ? slot.participant.id : `m-empty-${slot.index}`}
            >
              {renderSeatCard(slot, true)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
