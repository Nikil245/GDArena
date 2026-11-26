"use client";

import type { Room } from "@/lib/types";

interface TablePreviewProps {
  room: Room | null;
}

function formatStatusLabel(status: Room["status"]): string {
  switch (status) {
    case "lobby":
      return "Lobby";
    case "running":
      return "Running";
    case "finished":
      return "Finished";
  }
}

export function TablePreview({ room }: TablePreviewProps) {
  const seatCount = room
    ? Math.max(2, Math.min(10, room.max_participants))
    : 0;
  const seatRadius = seatCount <= 6 ? 12 : 10;
  const orbitRadius = 68;

  const seats = Array.from({ length: seatCount }, (_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / seatCount;
    return {
      index,
      cx: Number((130 + orbitRadius * Math.cos(angle)).toFixed(2)),
      cy: Number((90 + orbitRadius * Math.sin(angle)).toFixed(2)),
    };
  });

  const ariaLabel = room
    ? `Top-down round table preview for room ${room.code} with ${seatCount} seats`
    : "Neutral placeholder round table preview";

  return (
    <section className="ui-card p-5">
      <h2 className="text-card-title font-semibold text-ink">Table Preview</h2>

      <div className="ui-card-subtle mt-3 flex items-center justify-center px-4 py-3">
        <svg
          viewBox="0 0 260 180"
          role="img"
          aria-label={ariaLabel}
          className="mx-auto h-auto w-full max-w-[260px]"
        >
          {seats.map((seat) => (
            <circle
              key={seat.index}
              cx={seat.cx}
              cy={seat.cy}
              r={seatRadius}
              fill="#F1F5F9"
              stroke="#94A3B8"
              strokeWidth="1.5"
            />
          ))}
          <circle
            cx="130"
            cy="90"
            r="44"
            fill="#D8DEE6"
            stroke="#94A3B8"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      {room && (
        <div className="mt-3 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink-muted">
            <span className="font-semibold text-ink-secondary">
              Room {room.code}, {room.max_participants} seats
            </span>
            <span>
              {formatStatusLabel(room.status)} ·{" "}
              {Math.round(room.duration_seconds / 60)} min
            </span>
          </div>
          <p className="break-words text-sm font-medium text-ink">
            {room.topic}
          </p>
        </div>
      )}
    </section>
  );
}

