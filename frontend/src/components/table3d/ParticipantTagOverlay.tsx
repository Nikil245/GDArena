"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import type { Participant } from "@/lib/types";

export interface TagAnchor {
  object: THREE.Object3D;
  yOffset: number;
}

export type TagAnchorMap = Map<string, TagAnchor>;
export type TagElementMap = Map<string, HTMLDivElement>;

export interface OccupiedTagDescriptor {
  kind: "participant";
  tagKey: string;
  participant: Participant;
  isYou: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  aiPaused?: boolean;
  queuePosition: number | null;
}

export interface EmptySeatTagDescriptor {
  kind: "empty";
  tagKey: string;
  seatIndex: number;
  fillWithAi: boolean;
}

export type TagDescriptor = OccupiedTagDescriptor | EmptySeatTagDescriptor;

interface TagOverlayItemProps {
  tagKey: string;
  tagElementsRef: RefObject<TagElementMap>;
  children: ReactNode;
}

function TagOverlayItem({
  tagKey,
  tagElementsRef,
  children,
}: TagOverlayItemProps) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = tagElementsRef.current;
    const el = divRef.current;
    if (!map || !el) return;
    map.set(tagKey, el);
    return () => {
      if (map.get(tagKey) === el) {
        map.delete(tagKey);
      }
    };
  }, [tagKey, tagElementsRef]);

  return (
    <div
      ref={divRef}
      className="invisible pointer-events-none absolute left-0 top-0 will-change-transform"
    >
      {children}
    </div>
  );
}

export interface ParticipantTagOverlayProps {
  tags: TagDescriptor[];
  tagElementsRef: RefObject<TagElementMap>;
}

export function ParticipantTagOverlay({
  tags,
  tagElementsRef,
}: ParticipantTagOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none">
      {tags.map((tag) => {
        if (tag.kind === "empty") {
          return (
            <TagOverlayItem
              key={tag.tagKey}
              tagKey={tag.tagKey}
              tagElementsRef={tagElementsRef}
            >
              <div className="whitespace-nowrap rounded border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                Seat {tag.seatIndex + 1} ·{" "}
                {tag.fillWithAi ? "AI on start" : "Open"}
              </div>
            </TagOverlayItem>
          );
        }

        const isActiveTurn = tag.isSpeaking || tag.isThinking;
        const showQueue = tag.queuePosition !== null && !isActiveTurn;

        return (
          <TagOverlayItem
            key={tag.participant.id}
            tagKey={tag.tagKey}
            tagElementsRef={tagElementsRef}
          >
            <div className="flex flex-col items-center gap-0.5 whitespace-nowrap">
              {isActiveTurn && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white ${
                    tag.isSpeaking ? "bg-blue-800" : "bg-slate-600"
                  }`}
                >
                  {tag.isSpeaking ? "Speaking" : "Thinking"}
                </span>
              )}
              {showQueue && (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900">
                  Hand #{tag.queuePosition}
                </span>
              )}
              <div
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                  tag.isSpeaking
                    ? "border-2 border-blue-800 bg-blue-50 text-slate-900"
                    : tag.isThinking
                    ? "border-2 border-slate-400 bg-slate-50 text-slate-900"
                    : "border border-slate-300 bg-white text-slate-900"
                }`}
              >
                <span className="max-w-[100px] truncate font-semibold">
                  {tag.participant.name}
                </span>
                {tag.isYou && (
                  <span className="font-semibold text-blue-800">(You)</span>
                )}
                {tag.participant.role === "moderator" ? (
                  <span className="rounded border border-slate-300 bg-slate-100 px-1 py-0 text-[9px] font-semibold text-slate-700">
                    Moderator
                  </span>
                ) : tag.participant.is_ai ? (
                  tag.aiPaused ? (
                    <span className="rounded border border-amber-300 bg-amber-50 px-1 py-0 text-[9px] font-medium text-amber-900">
                      Paused
                    </span>
                  ) : (
                    <span className="rounded border border-slate-200 bg-slate-100 px-1 py-0 text-[9px] font-medium text-slate-600">
                      AI
                    </span>
                  )
                ) : null}
              </div>
            </div>
          </TagOverlayItem>
        );
      })}
    </div>
  );
}

