"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Box, Hand, LayoutGrid } from "lucide-react";
import {
  loadTableViewMode,
  saveTableViewMode,
  type TableViewMode,
} from "@/lib/storage";
import type { Participant, QueueItem, Room, Speaker } from "@/lib/types";
import { RoundTable2D } from "./RoundTable2D";
import { Table3DErrorBoundary } from "./table3d/Table3DErrorBoundary";
import { isWebGLAvailable } from "./table3d/webgl";

const DiscussionTable3D = dynamic(
  () =>
    import("./table3d/DiscussionTable3D").then((mod) => mod.DiscussionTable3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[270px] w-full items-center justify-center rounded-control border border-line bg-subtle text-caption font-medium text-ink-muted sm:h-[430px] lg:h-[470px]">
        Loading 3D Discussion Table...
      </div>
    ),
  }
);

interface RoundTableProps {
  room: Room;
  participants: Participant[];
  currentSpeaker: Speaker | null;
  ttsSpeakingParticipantId?: number | null;
  isHumanRecording?: boolean;
  aiPaused?: boolean;
  queue: QueueItem[];
  youId: number | null;
}

export function RoundTable({
  room,
  participants,
  currentSpeaker,
  ttsSpeakingParticipantId = null,
  isHumanRecording = false,
  aiPaused = false,
  queue,
  youId,
}: RoundTableProps) {
  const [mounted, setMounted] = useState(false);
  const [viewMode, setViewMode] = useState<TableViewMode>("3d");
  const [webglSupported, setWebglSupported] = useState(true);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    setViewMode(loadTableViewMode());
    setWebglSupported(isWebGLAvailable());

    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const syncCompact = () => setIsCompact(mediaQuery.matches);
    syncCompact();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncCompact);
    } else {
      mediaQuery.addListener(syncCompact);
    }

    setMounted(true);

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", syncCompact);
      } else {
        mediaQuery.removeListener(syncCompact);
      }
    };
  }, []);

  const handleSelectView = useCallback((mode: TableViewMode) => {
    setViewMode(mode);
    saveTableViewMode(mode);
  }, []);

  const handleSceneFailure = useCallback(() => {
    setSceneFailed(true);
  }, []);

  const players = participants.filter((p) => p.role === "player");
  const canRender3D = webglSupported && !sceneFailed;
  const showing3D = mounted && viewMode === "3d" && canRender3D;
  const fallbackNotice = mounted && viewMode === "3d" && !canRender3D;

  const fallback2D = (
    <RoundTable2D
      room={room}
      participants={participants}
      currentSpeaker={currentSpeaker}
      ttsSpeakingParticipantId={ttsSpeakingParticipantId}
      aiPaused={aiPaused}
      queue={queue}
      youId={youId}
    />
  );

  return (
    <section className="ui-card p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5">
          <h2 className="text-card-title font-semibold text-ink">
            Discussion Table
          </h2>
          <span className="text-caption text-ink-muted">
            {players.length}/{room.max_participants} seats
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-caption text-ink-muted sm:gap-2.5">
          {queue.length > 0 && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-chip border border-accent-border bg-accent-soft px-2 py-0.5 font-medium text-accent-text">
              <Hand className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">
                Queue: {queue.map((q) => q.name).join(", ")}
              </span>
            </span>
          )}

          {/* 2D / 3D View Toggle */}
          <div
            role="group"
            aria-label="Discussion table view mode"
            className="inline-flex shrink-0 rounded-chip border border-line bg-subtle p-0.5"
          >
            <button
              type="button"
              onClick={() => handleSelectView("3d")}
              disabled={mounted && !canRender3D}
              aria-pressed={showing3D}
              title={
                canRender3D
                  ? "Show 3D conference table"
                  : "3D view unavailable on this device"
              }
              className={`ui-focus inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap rounded-chip px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 sm:min-h-[28px] sm:px-2.5 sm:py-1 ${
                showing3D
                  ? "bg-surface font-semibold text-ink shadow-card"
                  : "text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
              }`}
            >
              <Box className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              3D view
            </button>
            <button
              type="button"
              onClick={() => handleSelectView("2d")}
              aria-pressed={mounted && !showing3D}
              className={`ui-focus inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap rounded-chip px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 sm:min-h-[28px] sm:px-2.5 sm:py-1 ${
                mounted && !showing3D
                  ? "bg-surface font-semibold text-ink shadow-card"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              <LayoutGrid className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              2D view
            </button>
          </div>
        </div>
      </div>

      {fallbackNotice && (
        <div className="ui-card-subtle mb-3 px-3 py-1.5 text-caption text-ink-secondary">
          3D view unavailable in this browser — showing 2D table.
        </div>
      )}

      {!mounted ? (
        <div className="flex h-[270px] w-full items-center justify-center rounded-control border border-line bg-subtle text-caption font-medium text-ink-muted sm:h-[430px] lg:h-[470px]">
          Preparing Discussion Table...
        </div>
      ) : showing3D ? (
        <Table3DErrorBoundary
          fallback={fallback2D}
          onError={handleSceneFailure}
        >
          <DiscussionTable3D
            room={room}
            participants={participants}
            currentSpeaker={currentSpeaker}
            ttsSpeakingParticipantId={ttsSpeakingParticipantId}
            isHumanRecording={isHumanRecording}
            aiPaused={aiPaused}
            queue={queue}
            youId={youId}
            isCompact={isCompact}
            onWebGLFailure={handleSceneFailure}
          />
        </Table3DErrorBoundary>
      ) : (
        fallback2D
      )}
    </section>
  );
}
