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
      <div className="flex h-[270px] w-full items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 sm:h-[430px] lg:h-[470px]">
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
  queue: QueueItem[];
  youId: number | null;
}

export function RoundTable({
  room,
  participants,
  currentSpeaker,
  ttsSpeakingParticipantId = null,
  isHumanRecording = false,
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
      queue={queue}
      youId={youId}
    />
  );

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Discussion Table
          </h2>
          <span className="text-xs text-slate-500">
            {players.length}/{room.max_participants} seats
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500">
          {queue.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-900">
              <Hand className="h-3 w-3" strokeWidth={1.75} />
              Queue: {queue.map((q) => q.name).join(", ")}
            </span>
          )}

          {/* 2D / 3D View Toggle */}
          <div
            role="group"
            aria-label="Discussion table view mode"
            className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5"
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
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
                showing3D
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
              }`}
            >
              <Box className="h-3 w-3" strokeWidth={1.75} />
              3D view
            </button>
            <button
              type="button"
              onClick={() => handleSelectView("2d")}
              aria-pressed={mounted && !showing3D}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
                mounted && !showing3D
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <LayoutGrid className="h-3 w-3" strokeWidth={1.75} />
              2D view
            </button>
          </div>
        </div>
      </div>

      {fallbackNotice && (
        <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          3D view unavailable in this browser — showing 2D table.
        </div>
      )}

      {!mounted ? (
        <div className="flex h-[270px] w-full items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 sm:h-[430px] lg:h-[470px]">
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
