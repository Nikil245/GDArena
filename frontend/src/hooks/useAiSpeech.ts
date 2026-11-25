"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPersonaVoiceSettings,
  isSpeechSupported,
  pickEnglishVoices,
  unlockSpeech,
} from "@/lib/speech";
import type { Participant, RoomStatus, TranscriptEntry } from "@/lib/types";

export interface UseAiSpeechResult {
  supported: boolean;
  muted: boolean;
  toggleMute: () => void;
  aiSpeakingParticipantId: number | null;
}

export function useAiSpeech(
  transcript: TranscriptEntry[] | undefined,
  participants: Participant[] | undefined,
  roomStatus: RoomStatus | undefined
): UseAiSpeechResult {
  const [supported, setSupported] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [aiSpeakingParticipantId, setAiSpeakingParticipantId] = useState<
    number | null
  >(null);

  const initializedRef = useRef(false);
  const lastSpokenTurnIdRef = useRef<number>(0);

  // Detect browser support & subscribe to async voices loading
  useEffect(() => {
    if (!isSpeechSupported()) return;
    setSupported(true);

    const synth = window.speechSynthesis;
    const refreshVoices = () => {
      const loaded = synth.getVoices();
      if (loaded.length > 0) {
        setVoices(pickEnglishVoices(loaded));
      }
    };

    refreshVoices();
    synth.addEventListener("voiceschanged", refreshVoices);

    return () => {
      synth.removeEventListener("voiceschanged", refreshVoices);
      try {
        synth.cancel();
      } catch {
        // Ignore
      }
    };
  }, []);

  // Cancel speech if muted or session finishes
  useEffect(() => {
    if (!isSpeechSupported()) return;
    if (muted || roomStatus === "finished") {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
      setAiSpeakingParticipantId(null);
    }
  }, [muted, roomStatus]);

  // Speak new AI transcript entries as they arrive
  useEffect(() => {
    if (!transcript) return;

    // On initial snapshot load (e.g. refresh), mark existing turns as already heard
    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSpokenTurnIdRef.current =
        transcript.length > 0 ? transcript[transcript.length - 1].turn_id : 0;
      return;
    }

    const newEntries = transcript.filter(
      (entry) => entry.turn_id > lastSpokenTurnIdRef.current
    );
    if (newEntries.length === 0) return;

    lastSpokenTurnIdRef.current = newEntries[newEntries.length - 1].turn_id;

    if (muted || roomStatus !== "running" || !isSpeechSupported()) {
      return;
    }

    const synth = window.speechSynthesis;
    const latestVoices =
      voices.length > 0 ? voices : pickEnglishVoices(synth.getVoices());

    for (const entry of newEntries) {
      if (!entry.is_ai || !entry.text.trim()) continue;
      const member = participants?.find((p) => p.id === entry.participant_id);
      const { voice, pitch, rate } = getPersonaVoiceSettings(
        member?.persona?.key,
        entry.participant_id,
        latestVoices
      );

      const utterance = new SpeechSynthesisUtterance(entry.text);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-IN";
      }
      utterance.pitch = pitch;
      utterance.rate = rate;

      utterance.onstart = () => {
        setAiSpeakingParticipantId(entry.participant_id);
      };
      utterance.onend = () => {
        setAiSpeakingParticipantId((prev) =>
          prev === entry.participant_id ? null : prev
        );
      };
      utterance.onerror = () => {
        setAiSpeakingParticipantId((prev) =>
          prev === entry.participant_id ? null : prev
        );
      };

      try {
        synth.resume();
        synth.speak(utterance);
      } catch {
        // Ignore browser speech errors
      }
    }
  }, [transcript, participants, roomStatus, muted, voices]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (!next) {
        unlockSpeech();
      } else if (isSpeechSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore
        }
        setAiSpeakingParticipantId(null);
      }
      return next;
    });
  }, []);

  return {
    supported,
    muted,
    toggleMute,
    aiSpeakingParticipantId,
  };
}

