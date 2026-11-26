"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { ComponentRef } from "react";
import * as THREE from "three";
import type { Participant, Speaker } from "@/lib/types";
import type { TableLayout, Vec3 } from "./layout";
import { ParticipantAvatar } from "./ParticipantAvatar";
import type { TagAnchorMap, TagElementMap } from "./ParticipantTagOverlay";
import { createSceneAssets } from "./sceneAssets";

export interface ConferenceRoomSceneProps {
  players: Participant[];
  moderator: Participant | null;
  totalPlayerSeats: number;
  localPlayerIndex: number;
  isLocalModerator: boolean;
  layout: TableLayout;
  queuePosition: Map<number, number>;
  currentSpeaker: Speaker | null;
  ttsSpeakingParticipantId: number | null;
  isHumanRecording: boolean;
  youId: number | null;
  isCompact: boolean;
  tagAnchorsRef: RefObject<TagAnchorMap>;
  tagElementsRef: RefObject<TagElementMap>;
}

interface TagOverlayProjectorProps {
  tagAnchorsRef: RefObject<TagAnchorMap>;
  tagElementsRef: RefObject<TagElementMap>;
}

function TagOverlayProjector({
  tagAnchorsRef,
  tagElementsRef,
}: TagOverlayProjectorProps) {
  const scratch = useMemo(
    () => ({
      worldPos: new THREE.Vector3(),
      camPos: new THREE.Vector3(),
      camDir: new THREE.Vector3(),
      toPoint: new THREE.Vector3(),
    }),
    []
  );

  useFrame(({ camera, size }) => {
    const anchors = tagAnchorsRef.current;
    const elements = tagElementsRef.current;
    if (!anchors || !elements || elements.size === 0) return;

    camera.updateMatrixWorld();
    const { worldPos, camPos, camDir, toPoint } = scratch;
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);

    elements.forEach((el, key) => {
      const anchor = anchors.get(key);
      if (!anchor) {
        if (el.style.visibility !== "hidden") {
          el.style.visibility = "hidden";
        }
        return;
      }

      anchor.object.getWorldPosition(worldPos);
      worldPos.y += anchor.yOffset;

      const depth = toPoint.copy(worldPos).sub(camPos).dot(camDir);
      if (depth <= 0) {
        if (el.style.visibility !== "hidden") {
          el.style.visibility = "hidden";
        }
        return;
      }

      worldPos.project(camera);
      if (worldPos.z < -1 || worldPos.z > 1) {
        if (el.style.visibility !== "hidden") {
          el.style.visibility = "hidden";
        }
        return;
      }

      const x = (worldPos.x * 0.5 + 0.5) * size.width;
      const y = (-worldPos.y * 0.5 + 0.5) * size.height;
      const nextTransform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      const nextZIndex = String(
        Math.max(1, Math.min(100, Math.round(100 - depth * 5)))
      );

      if (el.style.visibility !== "visible") {
        el.style.visibility = "visible";
      }
      if (el.style.transform !== nextTransform) {
        el.style.transform = nextTransform;
      }
      if (el.style.zIndex !== nextZIndex) {
        el.style.zIndex = nextZIndex;
      }
    });
  });

  return null;
}

interface CameraRigProps {
  cameraPosition: Vec3;
  defaultTarget: Vec3;
  speakerPosition: Vec3 | null;
  minDistance: number;
  maxDistance: number;
  seatCountKey: string;
}

function CameraRig({
  cameraPosition,
  defaultTarget,
  speakerPosition,
  minDistance,
  maxDistance,
  seatCountKey,
}: CameraRigProps) {
  const { camera } = useThree();
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
    if (controlsRef.current) {
      controlsRef.current.target.set(
        defaultTarget[0],
        defaultTarget[1],
        defaultTarget[2]
      );
      controlsRef.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatCountKey]);

  useFrame((_, delta) => {
    if (isDraggingRef.current || !controlsRef.current) return;
    const dt = Math.min(delta, 0.05);
    const target = controlsRef.current.target;
    const goalX = speakerPosition ? speakerPosition[0] * 0.22 : defaultTarget[0];
    const goalY = speakerPosition ? 0.88 : defaultTarget[1];
    const goalZ = speakerPosition ? speakerPosition[2] * 0.22 : defaultTarget[2];

    const nextX = THREE.MathUtils.damp(target.x, goalX, 2.2, dt);
    const nextY = THREE.MathUtils.damp(target.y, goalY, 2.2, dt);
    const nextZ = THREE.MathUtils.damp(target.z, goalZ, 2.2, dt);

    if (
      Math.abs(nextX - target.x) > 0.0002 ||
      Math.abs(nextY - target.y) > 0.0002 ||
      Math.abs(nextZ - target.z) > 0.0002
    ) {
      target.set(nextX, nextY, nextZ);
      controlsRef.current.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minAzimuthAngle={-0.72}
      maxAzimuthAngle={0.72}
      minPolarAngle={0.62}
      maxPolarAngle={1.26}
      minDistance={minDistance}
      maxDistance={maxDistance}
      onStart={() => {
        isDraggingRef.current = true;
      }}
      onEnd={() => {
        isDraggingRef.current = false;
      }}
    />
  );
}

export function ConferenceRoomScene({
  players,
  moderator,
  totalPlayerSeats,
  localPlayerIndex,
  isLocalModerator,
  layout,
  queuePosition,
  currentSpeaker,
  ttsSpeakingParticipantId,
  isHumanRecording,
  youId,
  isCompact,
  tagAnchorsRef,
  tagElementsRef,
}: ConferenceRoomSceneProps) {
  const assets = useMemo(() => createSceneAssets(), []);

  useEffect(() => {
    return () => {
      assets.dispose();
    };
  }, [assets]);

  const seatCountKey = `${totalPlayerSeats}:${Boolean(moderator)}:${localPlayerIndex}:${isLocalModerator}:${isCompact}`;

  const modQueuePos = moderator ? queuePosition.get(moderator.id) ?? null : null;

  const activeSpeakerId =
    ttsSpeakingParticipantId ?? currentSpeaker?.participant_id ?? null;

  const speakerPosition = useMemo<Vec3 | null>(() => {
    if (activeSpeakerId === null) return null;
    if (moderator && moderator.id === activeSpeakerId && layout.moderatorSeat) {
      return layout.moderatorSeat.position;
    }
    const idx = players.findIndex((p) => p.id === activeSpeakerId);
    if (idx >= 0 && idx < layout.playerSeats.length) {
      return layout.playerSeats[idx].position;
    }
    return null;
  }, [activeSpeakerId, moderator, players, layout]);

  return (
    <>
      <color attach="background" args={["#F1F5F9"]} />

      {/* Soft, even studio lighting */}
      <ambientLight intensity={0.78} color="#FFFFFF" />
      <hemisphereLight args={["#F8FAFC", "#CBD5E1", 0.55]} />
      <directionalLight
        position={[4.5, 8.5, 5.5]}
        intensity={0.9}
        castShadow={!isCompact}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-camera-left={-5.5}
        shadow-camera-right={5.5}
        shadow-camera-top={5.5}
        shadow-camera-bottom={-5.5}
        shadow-camera-near={1}
        shadow-camera-far={20}
      />

      <CameraRig
        cameraPosition={layout.cameraConfig.position}
        defaultTarget={layout.cameraConfig.target}
        speakerPosition={speakerPosition}
        minDistance={layout.cameraConfig.minDistance}
        maxDistance={layout.cameraConfig.maxDistance}
        seatCountKey={seatCountKey}
      />

      {/* Neutral matte floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        material={assets.materials.floor}
        receiveShadow
      >
        <circleGeometry args={[14, 48]} />
      </mesh>

      {/* Subtle flat floor mat under table */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        material={assets.materials.rug}
        receiveShadow
      >
        <circleGeometry args={[layout.seatRadius + 0.72, 48]} />
      </mesh>

      {/* Center round conference table */}
      <group>
        <mesh
          position={[0, 0.71, 0]}
          material={assets.materials.tableTop}
          castShadow
          receiveShadow
        >
          <cylinderGeometry
            args={[layout.tableRadius, layout.tableRadius, 0.06, 40]}
          />
        </mesh>
        <mesh
          position={[0, 0.655, 0]}
          material={assets.materials.tableFrame}
          castShadow
        >
          <cylinderGeometry
            args={[
              layout.tableRadius * 0.82,
              layout.tableRadius * 0.82,
              0.05,
              32,
            ]}
          />
        </mesh>
        <mesh
          position={[0, 0.34, 0]}
          material={assets.materials.tableFrame}
          castShadow
        >
          <cylinderGeometry args={[0.14, 0.18, 0.64, 16]} />
        </mesh>
        <mesh
          position={[0, 0.025, 0]}
          material={assets.materials.tableFrame}
          receiveShadow
        >
          <cylinderGeometry args={[0.58, 0.62, 0.04, 24]} />
        </mesh>
      </group>

      {/* Player seats (2..10 evenly spaced around table) */}
      {layout.playerSeats.map((seat) => {
        const participant = players[seat.index] ?? null;
        const isThinking = Boolean(
          participant &&
            currentSpeaker?.participant_id === participant.id &&
            currentSpeaker.phase === "thinking"
        );
        const isSpeaking = Boolean(
          participant &&
            (participant.is_ai
              ? ttsSpeakingParticipantId === participant.id
              : currentSpeaker?.participant_id === participant.id)
        );
        const qPos = participant ? queuePosition.get(participant.id) ?? null : null;
        const key = participant ? `p-${participant.id}` : `empty-${seat.index}`;

        return (
          <ParticipantAvatar
            key={key}
            tagKey={key}
            tagAnchorsRef={tagAnchorsRef}
            participant={participant}
            position={seat.position}
            rotationY={seat.rotationY}
            isYou={Boolean(participant && youId !== null && participant.id === youId)}
            isSpeaking={isSpeaking}
            isThinking={isThinking}
            isHumanRecording={isHumanRecording}
            queuePosition={qPos}
            assets={assets}
          />
        );
      })}

      {/* Dedicated Moderator seat & small desk at the head of the table */}
      {moderator && layout.moderatorSeat && (
        <group>
          <group
            position={layout.moderatorSeat.deskPosition}
            rotation={[0, layout.moderatorSeat.deskRotationY, 0]}
          >
            <mesh
              geometry={assets.geometries.modDeskTop}
              material={assets.materials.modDeskTop}
              position={[0, 0.71, 0]}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={assets.geometries.modDeskLeg}
              material={assets.materials.tableFrame}
              position={[-0.37, 0.35, -0.17]}
              castShadow
            />
            <mesh
              geometry={assets.geometries.modDeskLeg}
              material={assets.materials.tableFrame}
              position={[0.37, 0.35, -0.17]}
              castShadow
            />
            <mesh
              geometry={assets.geometries.modDeskLeg}
              material={assets.materials.tableFrame}
              position={[-0.37, 0.35, 0.17]}
              castShadow
            />
            <mesh
              geometry={assets.geometries.modDeskLeg}
              material={assets.materials.tableFrame}
              position={[0.37, 0.35, 0.17]}
              castShadow
            />
            <mesh
              geometry={assets.geometries.modNotepad}
              material={assets.materials.notepadPaper}
              position={[0, 0.736, -0.02]}
              receiveShadow
            />
          </group>

          <ParticipantAvatar
            key={`p-${moderator.id}`}
            tagKey={`p-${moderator.id}`}
            tagAnchorsRef={tagAnchorsRef}
            participant={moderator}
            position={layout.moderatorSeat.position}
            rotationY={layout.moderatorSeat.rotationY}
            isModeratorSeat
            isYou={youId !== null && moderator.id === youId}
            isSpeaking={currentSpeaker?.participant_id === moderator.id}
            isThinking={false}
            isHumanRecording={isHumanRecording}
            queuePosition={modQueuePos}
            assets={assets}
          />
        </group>
      )}

      <TagOverlayProjector
        tagAnchorsRef={tagAnchorsRef}
        tagElementsRef={tagElementsRef}
      />
    </>
  );
}

