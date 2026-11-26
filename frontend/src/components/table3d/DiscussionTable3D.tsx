"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { Participant, QueueItem, Room, Speaker } from "@/lib/types";
import { ConferenceRoomScene } from "./ConferenceRoomScene";
import { computeTableLayout } from "./layout";
import {
  ParticipantTagOverlay,
  type TagAnchorMap,
  type TagDescriptor,
  type TagElementMap,
} from "./ParticipantTagOverlay";

export interface DiscussionTable3DProps {
  room: Room;
  participants: Participant[];
  currentSpeaker: Speaker | null;
  ttsSpeakingParticipantId?: number | null;
  isHumanRecording?: boolean;
  queue: QueueItem[];
  youId: number | null;
  isCompact?: boolean;
  onWebGLFailure?: () => void;
}

export function DiscussionTable3D({
  room,
  participants,
  currentSpeaker,
  ttsSpeakingParticipantId = null,
  isHumanRecording = false,
  queue,
  youId,
  isCompact = false,
  onWebGLFailure,
}: DiscussionTable3DProps) {
  const [isTabVisible, setIsTabVisible] = useState<boolean>(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState !== "hidden"
  );
  const cleanupContextListenerRef = useRef<(() => void) | null>(null);
  const tagAnchorsRef = useRef<TagAnchorMap>(new Map());
  const tagElementsRef = useRef<TagElementMap>(new Map());

  useEffect(() => {
    const handleVisibility = () => {
      setIsTabVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupContextListenerRef.current?.();
      cleanupContextListenerRef.current = null;
    };
  }, []);

  const players = useMemo(
    () =>
      participants
        .filter((p) => p.role === "player")
        .sort((a, b) => a.id - b.id),
    [participants]
  );

  const moderator = useMemo(
    () => participants.find((p) => p.role === "moderator") ?? null,
    [participants]
  );

  const totalPlayerSeats = Math.max(room.max_participants, players.length, 2);

  const localPlayerIndex = useMemo(
    () =>
      youId !== null ? players.findIndex((player) => player.id === youId) : -1,
    [players, youId]
  );

  const isLocalModerator = Boolean(
    moderator && youId !== null && moderator.id === youId
  );

  const layout = useMemo(
    () =>
      computeTableLayout({
        totalPlayerSeats,
        hasModerator: Boolean(moderator),
        localPlayerIndex,
        isLocalModerator,
        isCompact,
      }),
    [
      totalPlayerSeats,
      moderator,
      localPlayerIndex,
      isLocalModerator,
      isCompact,
    ]
  );

  const [initialCameraPos] = useState(() => layout.cameraConfig.position);

  const queuePosition = useMemo(() => {
    const map = new Map<number, number>();
    queue.forEach((item, idx) => {
      map.set(item.participant_id, idx + 1);
    });
    return map;
  }, [queue]);

  const tags = useMemo<TagDescriptor[]>(() => {
    const result: TagDescriptor[] = layout.playerSeats.map((seat) => {
      const participant = players[seat.index] ?? null;
      if (!participant) {
        return {
          kind: "empty",
          tagKey: `empty-${seat.index}`,
          seatIndex: seat.index,
          fillWithAi: room.fill_with_ai,
        };
      }

      const isThinking = Boolean(
        currentSpeaker?.participant_id === participant.id &&
          currentSpeaker.phase === "thinking"
      );
      const isSpeaking = Boolean(
        participant.is_ai
          ? ttsSpeakingParticipantId === participant.id
          : currentSpeaker?.participant_id === participant.id
      );

      return {
        kind: "participant",
        tagKey: `p-${participant.id}`,
        participant,
        isYou: youId !== null && participant.id === youId,
        isSpeaking,
        isThinking,
        queuePosition: queuePosition.get(participant.id) ?? null,
      };
    });

    if (moderator && layout.moderatorSeat) {
      result.push({
        kind: "participant",
        tagKey: `p-${moderator.id}`,
        participant: moderator,
        isYou: youId !== null && moderator.id === youId,
        isSpeaking: currentSpeaker?.participant_id === moderator.id,
        isThinking: false,
        queuePosition: queuePosition.get(moderator.id) ?? null,
      });
    }

    return result;
  }, [
    layout,
    players,
    moderator,
    room.fill_with_ai,
    currentSpeaker,
    ttsSpeakingParticipantId,
    queuePosition,
    youId,
  ]);

  const playersCount = players.length;

  const statusText = useMemo(() => {
    if (room.status === "lobby") {
      return `Lobby · ${playersCount}/${room.max_participants} seats`;
    }
    if (ttsSpeakingParticipantId !== null) {
      const ttsSpeaker = participants.find(
        (p) => p.id === ttsSpeakingParticipantId
      );
      if (ttsSpeaker) {
        return `Speaking · ${ttsSpeaker.name}`;
      }
    }
    if (currentSpeaker) {
      return currentSpeaker.phase === "thinking"
        ? `Preparing point · ${currentSpeaker.name}`
        : `Speaking · ${currentSpeaker.name}`;
    }
    return "Floor open · No active speaker";
  }, [
    room.status,
    room.max_participants,
    playersCount,
    participants,
    ttsSpeakingParticipantId,
    currentSpeaker,
  ]);

  return (
    <div className="relative h-[270px] w-full overflow-hidden rounded border border-slate-200 bg-slate-100 sm:h-[430px] lg:h-[470px]">
      <Canvas
        dpr={[1, 2]}
        shadows={!isCompact}
        frameloop={isTabVisible ? "always" : "never"}
        camera={{ fov: 44, near: 0.1, far: 45, position: initialCameraPos }}
        gl={{ antialias: true, powerPreference: "default" }}
        onCreated={({ gl }) => {
          cleanupContextListenerRef.current?.();
          const canvas = gl.domElement;
          const handleContextLost = (event: Event) => {
            event.preventDefault();
            onWebGLFailure?.();
          };
          canvas.addEventListener("webglcontextlost", handleContextLost);
          cleanupContextListenerRef.current = () => {
            canvas.removeEventListener("webglcontextlost", handleContextLost);
          };
        }}
      >
        <ConferenceRoomScene
          players={players}
          moderator={moderator}
          totalPlayerSeats={totalPlayerSeats}
          localPlayerIndex={localPlayerIndex}
          isLocalModerator={isLocalModerator}
          layout={layout}
          queuePosition={queuePosition}
          currentSpeaker={currentSpeaker}
          ttsSpeakingParticipantId={ttsSpeakingParticipantId}
          isHumanRecording={isHumanRecording}
          youId={youId}
          isCompact={isCompact}
          tagAnchorsRef={tagAnchorsRef}
          tagElementsRef={tagElementsRef}
        />
      </Canvas>

      <ParticipantTagOverlay tags={tags} tagElementsRef={tagElementsRef} />

      {/* Flat status indicator */}
      <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-20 max-w-[calc(100%-20px)] truncate rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
        {statusText}
      </div>

      {/* Subtle camera control hint on tablet/desktop */}
      <div className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 hidden rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500 sm:block">
        Drag to look · Scroll to zoom
      </div>
    </div>
  );
}
