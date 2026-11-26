"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sampleAudioLevel } from "@/lib/audioLevel";
import { getParticipantAppearance } from "@/lib/avatar";
import type { Participant } from "@/lib/types";
import type { Vec3 } from "./layout";
import type { TagAnchor, TagAnchorMap } from "./ParticipantTagOverlay";
import type { SceneAssets } from "./sceneAssets";

export interface ParticipantAvatarProps {
  tagKey: string;
  tagAnchorsRef: RefObject<TagAnchorMap>;
  participant: Participant | null;
  position: Vec3;
  rotationY: number;
  isModeratorSeat?: boolean;
  isYou: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  isHumanRecording?: boolean;
  queuePosition: number | null;
  assets: SceneAssets;
}

function timedSpeechFallback(t: number, phase: number): number {
  const gate = Math.sin(t * 2.4 + phase * 1.7);
  if (gate <= -0.18) return 0;
  const raw =
    0.34 +
    0.34 * Math.sin(t * 11.5 + phase) +
    0.22 * Math.sin(t * 18.7 + phase * 0.7);
  return Math.max(0, Math.min(1, raw));
}

const CURL_OFFSETS: readonly Vec3[] = [
  [0, 0.125, 0.035],
  [-0.075, 0.11, 0.025],
  [0.075, 0.11, 0.025],
  [-0.1, 0.085, -0.045],
  [0.1, 0.085, -0.045],
  [0, 0.115, -0.065],
  [-0.06, 0.07, -0.105],
  [0.06, 0.07, -0.105],
];

export function ParticipantAvatar({
  tagKey,
  tagAnchorsRef,
  participant,
  position,
  rotationY,
  isModeratorSeat = false,
  isYou,
  isSpeaking,
  isThinking,
  isHumanRecording = false,
  queuePosition,
  assets,
}: ParticipantAvatarProps) {
  const rootGroupRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const leftElbowRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const rightElbowRef = useRef<THREE.Group>(null);

  const appearance = useMemo(() => {
    if (!participant) return null;
    return getParticipantAppearance(
      participant.id,
      participant.name,
      participant.role
    );
  }, [participant]);

  const g = assets.geometries;
  const m = assets.materials;

  const isOccupied = Boolean(participant && appearance);
  const isActiveTurn = isSpeaking || isThinking;
  const isHandRaised = queuePosition !== null && !isActiveTurn;

  useEffect(() => {
    const anchors = tagAnchorsRef.current;
    if (!anchors) return;
    const target = isOccupied ? headRef.current : rootGroupRef.current;
    if (!target) return;
    const anchor: TagAnchor = {
      object: target,
      yOffset: isOccupied ? 0.39 : 1.05,
    };
    anchors.set(tagKey, anchor);
    return () => {
      if (anchors.get(tagKey) === anchor) {
        anchors.delete(tagKey);
      }
    };
  }, [tagKey, isOccupied, tagAnchorsRef]);

  // Idle breathing/sway + raised-hand + audio-driven mouth & hand gestures
  useFrame((state, delta) => {
    if (!appearance || !participant) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.getElapsedTime();
    const { idlePhase, idleSpeed } = appearance;

    // 1. Subtle breathing (distinct per person)
    if (torsoRef.current) {
      const breath = Math.sin(t * 1.45 * idleSpeed + idlePhase);
      torsoRef.current.position.y = 0.54 + breath * 0.006;
      torsoRef.current.scale.y = 1 + breath * 0.012;
    }

    // 2. Mouth loudness level (Web Audio API AnalyserNode with timed fallback)
    let mouthTarget = 0;
    if (isSpeaking) {
      if (participant.is_ai) {
        const aiSample = sampleAudioLevel("ai");
        mouthTarget = aiSample.available
          ? aiSample.level
          : timedSpeechFallback(t, idlePhase);
      } else if (isYou) {
        if (isHumanRecording) {
          const micSample = sampleAudioLevel("mic");
          mouthTarget = micSample.available
            ? micSample.level
            : timedSpeechFallback(t, idlePhase);
        } else {
          mouthTarget = 0;
        }
      } else {
        mouthTarget = timedSpeechFallback(t, idlePhase);
      }
    }

    if (mouthRef.current) {
      const targetScaleY = 0.22 + mouthTarget * 1.03;
      const targetScaleX = 1.15 - mouthTarget * 0.12;
      mouthRef.current.scale.y = THREE.MathUtils.damp(
        mouthRef.current.scale.y,
        targetScaleY,
        22,
        dt
      );
      mouthRef.current.scale.x = THREE.MathUtils.damp(
        mouthRef.current.scale.x,
        targetScaleX,
        22,
        dt
      );
    }

    // 3. Subtle head orientation & conversational nod / idle sway
    if (headRef.current) {
      const speechEnergy = 0.4 + mouthTarget * 0.6;
      const targetHeadY = isSpeaking
        ? Math.sin(t * 1.15 + idlePhase) * 0.06
        : isThinking
        ? Math.sin(t * 0.9 + idlePhase) * 0.04
        : Math.sin(t * 0.55 * idleSpeed + idlePhase) * 0.05;
      const targetHeadX = isSpeaking
        ? -0.04 + Math.sin(t * 2.6 + idlePhase) * 0.045 * speechEnergy
        : isThinking
        ? -0.05
        : 0;
      const targetHeadZ = isSpeaking
        ? Math.sin(t * 1.4 + idlePhase) * 0.02
        : Math.sin(t * 0.4 * idleSpeed + idlePhase * 1.3) * 0.025;

      headRef.current.rotation.y = THREE.MathUtils.damp(
        headRef.current.rotation.y,
        targetHeadY,
        6.5,
        dt
      );
      headRef.current.rotation.x = THREE.MathUtils.damp(
        headRef.current.rotation.x,
        targetHeadX,
        6.5,
        dt
      );
      headRef.current.rotation.z = THREE.MathUtils.damp(
        headRef.current.rotation.z,
        targetHeadZ,
        6.5,
        dt
      );
    }

    // 4. Left & right arm posture: raised hand vs speaking gesture vs resting
    const gestureAmp = 0.35 + mouthTarget * 0.65;
    if (leftArmRef.current && leftElbowRef.current) {
      const targetLeftShoulderX = isSpeaking
        ? -0.44 + Math.sin(t * 2.2 + idlePhase) * 0.08 * gestureAmp
        : -0.35;
      const targetLeftElbowX = isSpeaking
        ? -1.1 + Math.cos(t * 2.5 + idlePhase) * 0.11 * gestureAmp
        : -0.95;

      leftArmRef.current.rotation.x = THREE.MathUtils.damp(
        leftArmRef.current.rotation.x,
        targetLeftShoulderX,
        6.5,
        dt
      );
      leftElbowRef.current.rotation.x = THREE.MathUtils.damp(
        leftElbowRef.current.rotation.x,
        targetLeftElbowX,
        6.5,
        dt
      );
    }

    if (rightArmRef.current && rightElbowRef.current) {
      const targetShoulderX = isHandRaised
        ? -2.72
        : isSpeaking
        ? -0.46 + Math.sin(t * 2.4 + idlePhase + 1.1) * 0.09 * gestureAmp
        : -0.35;
      const targetShoulderZ = isHandRaised ? -0.12 : -0.08;
      const targetElbowX = isHandRaised
        ? -0.25
        : isSpeaking
        ? -1.14 + Math.cos(t * 2.7 + idlePhase + 0.8) * 0.11 * gestureAmp
        : -0.95;

      rightArmRef.current.rotation.x = THREE.MathUtils.damp(
        rightArmRef.current.rotation.x,
        targetShoulderX,
        7.5,
        dt
      );
      rightArmRef.current.rotation.z = THREE.MathUtils.damp(
        rightArmRef.current.rotation.z,
        targetShoulderZ,
        7.5,
        dt
      );
      rightElbowRef.current.rotation.x = THREE.MathUtils.damp(
        rightElbowRef.current.rotation.x,
        targetElbowX,
        7.5,
        dt
      );
    }
  });

  const chairCushionMat = isModeratorSeat ? m.modChairCushion : m.chairCushion;

  const renderHair = () => {
    if (!appearance) return null;
    const hairMat = assets.getMat(appearance.hairColor, 0.88);
    switch (appearance.hairStyle) {
      case "parted":
        return (
          <group>
            <mesh geometry={g.hairCap} material={hairMat} castShadow />
            <mesh
              geometry={g.hairPartedTuft}
              material={hairMat}
              position={[0.015, 0.115, 0.02]}
              rotation={[0.08, 0, -0.12]}
              castShadow
            />
          </group>
        );
      case "bob":
        return (
          <group>
            <mesh geometry={g.hairCap} material={hairMat} castShadow />
            <mesh
              geometry={g.hairBobSide}
              material={hairMat}
              position={[-0.12, -0.02, -0.01]}
              castShadow
            />
            <mesh
              geometry={g.hairBobSide}
              material={hairMat}
              position={[0.12, -0.02, -0.01]}
              castShadow
            />
            <mesh
              geometry={g.hairBobBack}
              material={hairMat}
              position={[0, -0.03, -0.105]}
              castShadow
            />
          </group>
        );
      case "bun":
        return (
          <group>
            <mesh geometry={g.hairCap} material={hairMat} castShadow />
            <mesh
              geometry={g.hairBun}
              material={hairMat}
              position={[0, 0.105, -0.13]}
              castShadow
            />
          </group>
        );
      case "textured":
        return (
          <group>
            <mesh geometry={g.hairCap} material={hairMat} castShadow />
            {CURL_OFFSETS.map((offset, idx) => (
              <mesh
                key={idx}
                geometry={g.hairCurl}
                material={hairMat}
                position={offset}
                castShadow
              />
            ))}
          </group>
        );
      case "short":
      default:
        return (
          <mesh
            geometry={g.hairCap}
            material={hairMat}
            position={[0, 0.005, -0.006]}
            castShadow
          />
        );
    }
  };

  return (
    <group ref={rootGroupRef} position={position} rotation={[0, rotationY, 0]}>
      {/* Flat floor ring under active speaker or thinking turn (no glow) */}
      {isActiveTurn && (
        <mesh
          geometry={g.floorRing}
          material={isSpeaking ? m.speakingRing : m.thinkingRing}
          position={[0, 0.008, 0.02]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      )}

      {/* Chair */}
      <group>
        <mesh
          geometry={g.chairSeat}
          material={chairCushionMat}
          position={[0, 0.44, 0.02]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={isModeratorSeat ? g.modChairBack : g.chairBack}
          material={chairCushionMat}
          position={[0, isModeratorSeat ? 0.72 : 0.68, -0.175]}
          rotation={[-0.08, 0, 0]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={g.chairSpine}
          material={m.chairFrame}
          position={[0, 0.56, -0.19]}
          castShadow
        />
        <mesh
          geometry={g.chairLeg}
          material={m.chairFrame}
          position={[-0.17, 0.21, 0.17]}
          castShadow
        />
        <mesh
          geometry={g.chairLeg}
          material={m.chairFrame}
          position={[0.17, 0.21, 0.17]}
          castShadow
        />
        <mesh
          geometry={g.chairLeg}
          material={m.chairFrame}
          position={[-0.17, 0.21, -0.15]}
          castShadow
        />
        <mesh
          geometry={g.chairLeg}
          material={m.chairFrame}
          position={[0.17, 0.21, -0.15]}
          castShadow
        />
      </group>

      {!participant || !appearance ? null : (
        <group>
          {/* Seated lower body */}
          <mesh
            geometry={g.pelvis}
            material={assets.getMat(appearance.trouserColor, 0.88)}
            position={[0, 0.5, 0.02]}
            castShadow
            receiveShadow
          />

          {/* Left Leg */}
          <group position={[-0.082, 0.49, 0.04]}>
            <mesh
              geometry={g.thigh}
              material={assets.getMat(appearance.trouserColor, 0.88)}
              position={[0, 0, 0.15]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            />
            <mesh
              geometry={g.shin}
              material={assets.getMat(appearance.trouserColor, 0.88)}
              position={[0, -0.21, 0.29]}
              castShadow
            />
            <mesh
              geometry={g.shoe}
              material={m.shoe}
              position={[0, -0.44, 0.32]}
              castShadow
            />
          </group>

          {/* Right Leg */}
          <group position={[0.082, 0.49, 0.04]}>
            <mesh
              geometry={g.thigh}
              material={assets.getMat(appearance.trouserColor, 0.88)}
              position={[0, 0, 0.15]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            />
            <mesh
              geometry={g.shin}
              material={assets.getMat(appearance.trouserColor, 0.88)}
              position={[0, -0.21, 0.29]}
              castShadow
            />
            <mesh
              geometry={g.shoe}
              material={m.shoe}
              position={[0, -0.44, 0.32]}
              castShadow
            />
          </group>

          {/* Upper Body / Torso */}
          <group ref={torsoRef} position={[0, 0.54, 0]}>
            <mesh
              geometry={g.torso}
              material={assets.getMat(appearance.shirtColor, 0.82)}
              position={[0, 0.21, 0]}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={g.shoulders}
              material={assets.getMat(appearance.shirtColor, 0.82)}
              position={[0, 0.38, 0]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            />
            <mesh
              geometry={g.collar}
              material={m.collar}
              position={[0, 0.43, 0]}
            />
            <mesh
              geometry={g.neck}
              material={assets.getMat(appearance.skinColor, 0.78)}
              position={[0, 0.47, 0]}
            />

            {/* Head */}
            <group ref={headRef} position={[0, 0.61, 0.01]}>
              <mesh
                geometry={g.head}
                material={assets.getMat(appearance.skinColor, 0.78)}
                castShadow
                receiveShadow
              />
              {/* Ears */}
              <mesh
                geometry={g.ear}
                material={assets.getMat(appearance.skinColor, 0.78)}
                position={[-0.132, -0.005, 0]}
              />
              <mesh
                geometry={g.ear}
                material={assets.getMat(appearance.skinColor, 0.78)}
                position={[0.132, -0.005, 0]}
              />
              {/* Eyes & Eyebrows */}
              <mesh
                geometry={g.eye}
                material={m.eye}
                position={[-0.045, 0.02, 0.122]}
              />
              <mesh
                geometry={g.eye}
                material={m.eye}
                position={[0.045, 0.02, 0.122]}
              />
              <mesh
                geometry={g.eyebrow}
                material={assets.getMat(appearance.hairColor, 0.88)}
                position={[-0.045, 0.048, 0.124]}
              />
              <mesh
                geometry={g.eyebrow}
                material={assets.getMat(appearance.hairColor, 0.88)}
                position={[0.045, 0.048, 0.124]}
              />
              {/* Nose */}
              <mesh
                geometry={g.nose}
                material={assets.getMat(appearance.skinColor, 0.78)}
                position={[0, -0.005, 0.134]}
              />
              {/* Mouth */}
              <mesh
                ref={mouthRef}
                geometry={g.mouth}
                material={m.mouth}
                position={[0, -0.052, 0.124]}
                scale={[1.15, 0.22, 0.4]}
              />

              {/* Procedural Hair */}
              {renderHair()}
            </group>

            {/* Left Arm */}
            <group
              ref={leftArmRef}
              position={[-0.21, 0.36, 0]}
              rotation={[-0.35, 0, 0.08]}
            >
              <mesh
                geometry={g.upperArm}
                material={assets.getMat(appearance.shirtColor, 0.82)}
                position={[0, -0.11, 0]}
                castShadow
              />
              <group
                ref={leftElbowRef}
                position={[0, -0.22, 0]}
                rotation={[-0.95, 0, 0]}
              >
                <mesh
                  geometry={g.forearm}
                  material={assets.getMat(appearance.skinColor, 0.78)}
                  position={[0, -0.1, 0]}
                  castShadow
                />
                <mesh
                  geometry={g.hand}
                  material={assets.getMat(appearance.skinColor, 0.78)}
                  position={[0, -0.21, 0]}
                />
              </group>
            </group>

            {/* Right Arm */}
            <group
              ref={rightArmRef}
              position={[0.21, 0.36, 0]}
              rotation={[-0.35, 0, -0.08]}
            >
              <mesh
                geometry={g.upperArm}
                material={assets.getMat(appearance.shirtColor, 0.82)}
                position={[0, -0.11, 0]}
                castShadow
              />
              <group
                ref={rightElbowRef}
                position={[0, -0.22, 0]}
                rotation={[-0.95, 0, 0]}
              >
                <mesh
                  geometry={g.forearm}
                  material={assets.getMat(appearance.skinColor, 0.78)}
                  position={[0, -0.1, 0]}
                  castShadow
                />
                <mesh
                  geometry={g.hand}
                  material={assets.getMat(appearance.skinColor, 0.78)}
                  position={[0, -0.21, 0]}
                />
              </group>
            </group>
          </group>
        </group>
      )}
    </group>
  );
}

