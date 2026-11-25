"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchTestVoice, resolveApiUrl } from "@/lib/api";
import {
  getPersonaVoiceSettings,
  hasSpeechSynthesisVoices,
  isSpeechSupported,
  pickEnglishVoices,
  unlockAudio,
} from "@/lib/speech";
import type { Participant, RoomStatus, TranscriptEntry } from "@/lib/types";

interface QueuedSpeechItem {
  turnId: number;
  participantId: number;
  text: string;
  audioUrl: string | null;
  personaKey: string | null;
}

export interface UseAiSpeechOptions {
  transcript: TranscriptEntry[] | undefined;
  participants: Participant[] | undefined;
  roomStatus: RoomStatus | undefined;
  welcomeCount: number;
  isHumanRecording: boolean;
}

export interface UseAiSpeechResult {
  muted: boolean;
  toggleMute: () => void;
  autoplayBlocked: boolean;
  enableAudio: () => void;
  testVoice: () => Promise<void>;
  testingVoice: boolean;
  voiceNotice: string | null;
  clearVoiceNotice: () => void;
  aiSpeakingParticipantId: number | null;
}

export function useAiSpeech({
  transcript,
  participants,
  roomStatus,
  welcomeCount,
  isHumanRecording,
}: UseAiSpeechOptions): UseAiSpeechResult {
  const [muted, setMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [aiSpeakingParticipantId, setAiSpeakingParticipantId] = useState<
    number | null
  >(null);

  const queueRef = useRef<QueuedSpeechItem[]>([]);
  const playingRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeTestUrlRef = useRef<string | null>(null);
  const mutedRef = useRef(muted);
  const roomStatusRef = useRef(roomStatus);
  const humanRecordingRef = useRef(isHumanRecording);
  const lastWelcomeCountRef = useRef<number>(0);
  const lastProcessedTurnIdRef = useRef<number>(0);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  mutedRef.current = muted;
  roomStatusRef.current = roomStatus;
  humanRecordingRef.current = isHumanRecording;

  const stopActivePlayback = useCallback((clearQueue: boolean) => {
    if (clearQueue) {
      queueRef.current = [];
    }
    const audio = activeAudioRef.current;
    if (audio) {
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.src = "";
      } catch {
        // Ignore
      }
      activeAudioRef.current = null;
    }
    if (activeTestUrlRef.current) {
      URL.revokeObjectURL(activeTestUrlRef.current);
      activeTestUrlRef.current = null;
    }
    if (isSpeechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    playingRef.current = false;
    setTestingVoice(false);
    setAiSpeakingParticipantId(null);
  }, []);

  // Load browser speechSynthesis voices asynchronously (used only as fallback when audio_url fails/is null)
  useEffect(() => {
    if (!isSpeechSupported()) return;
    const synth = window.speechSynthesis;
    const refresh = () => {
      const loaded = synth.getVoices();
      if (loaded.length > 0) {
        voicesRef.current = pickEnglishVoices(loaded);
      }
    };
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => {
      synth.removeEventListener("voiceschanged", refresh);
    };
  }, []);

  const playNextRef = useRef<() => void>(() => {});

  const speakWithFallback = useCallback(
    (item: QueuedSpeechItem): boolean => {
      if (!hasSpeechSynthesisVoices()) {
        return false;
      }
      const synth = window.speechSynthesis;
      const available =
        voicesRef.current.length > 0
          ? voicesRef.current
          : pickEnglishVoices(synth.getVoices());
      const { voice, pitch, rate } = getPersonaVoiceSettings(
        item.personaKey,
        item.participantId,
        available
      );
      const utterance = new SpeechSynthesisUtterance(item.text);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-IN";
      }
      utterance.pitch = pitch;
      utterance.rate = rate;
      utterance.onstart = () => {
        setAiSpeakingParticipantId(item.participantId);
      };
      utterance.onend = () => {
        playingRef.current = false;
        setAiSpeakingParticipantId(null);
        playNextRef.current();
      };
      utterance.onerror = (ev) => {
        console.error("[GDArena Audio] Fallback speechSynthesis error:", ev);
        playingRef.current = false;
        setAiSpeakingParticipantId(null);
        playNextRef.current();
      };
      try {
        synth.resume();
        synth.speak(utterance);
        return true;
      } catch (err) {
        console.error("[GDArena Audio] Fallback speechSynthesis failed:", err);
        return false;
      }
    },
    []
  );

  const playNext = useCallback(() => {
    if (
      playingRef.current ||
      mutedRef.current ||
      roomStatusRef.current !== "running" ||
      humanRecordingRef.current
    ) {
      return;
    }

    const nextItem = queueRef.current.shift();
    if (!nextItem) return;

    playingRef.current = true;

    if (nextItem.audioUrl) {
      const fullUrl = resolveApiUrl(nextItem.audioUrl);
      const audio = new Audio(fullUrl);
      activeAudioRef.current = audio;

      const finishAndAdvance = (fallback: boolean) => {
        if (activeAudioRef.current !== audio) return;
        activeAudioRef.current = null;
        if (fallback && !mutedRef.current && !humanRecordingRef.current) {
          if (speakWithFallback(nextItem)) {
            return;
          }
        }
        playingRef.current = false;
        setAiSpeakingParticipantId(null);
        playNextRef.current();
      };

      audio.onplaying = () => {
        if (activeAudioRef.current !== audio) return;
        setAutoplayBlocked(false);
        setAiSpeakingParticipantId(nextItem.participantId);
      };
      audio.onended = () => finishAndAdvance(false);
      audio.onerror = () => {
        console.error(
          "[GDArena Audio] HTMLAudioElement error loading/playing:",
          fullUrl,
          audio.error
        );
        finishAndAdvance(true);
      };

      try {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err: unknown) => {
            if (activeAudioRef.current !== audio) return;
            const errName =
              err instanceof DOMException
                ? err.name
                : err && typeof err === "object" && "name" in err
                ? String((err as { name: unknown }).name)
                : "";
            if (errName === "NotAllowedError") {
              console.error(
                "[GDArena Audio] Autoplay blocked by browser (NotAllowedError):",
                err
              );
              activeAudioRef.current = null;
              playingRef.current = false;
              setAiSpeakingParticipantId(null);
              setAutoplayBlocked(true);
              queueRef.current.unshift(nextItem);
              return;
            }
            console.error("[GDArena Audio] audio.play() rejected:", err);
            finishAndAdvance(true);
          });
        }
      } catch (err) {
        console.error("[GDArena Audio] Synchronous audio.play() error:", err);
        finishAndAdvance(true);
      }
      return;
    }

    // No audio_url provided (e.g. server TTS failed or disabled) -> fallback to speechSynthesis if available
    if (speakWithFallback(nextItem)) {
      return;
    }
    playingRef.current = false;
    setAiSpeakingParticipantId(null);
    playNextRef.current();
  }, [speakWithFallback]);

  playNextRef.current = playNext;

  // Never play AI audio over a human microphone recording
  useEffect(() => {
    if (isHumanRecording) {
      stopActivePlayback(true);
    }
  }, [isHumanRecording, stopActivePlayback]);

  // Stop audio when muted or session finishes
  useEffect(() => {
    if (muted || roomStatus === "finished") {
      stopActivePlayback(true);
    }
  }, [muted, roomStatus, stopActivePlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopActivePlayback(true);
    };
  }, [stopActivePlayback]);

  // Enqueue ONLY newly arriving AI turns (never replay old turns on load or reconnect)
  useEffect(() => {
    if (!transcript) return;

    if (welcomeCount > lastWelcomeCountRef.current) {
      lastWelcomeCountRef.current = welcomeCount;
      lastProcessedTurnIdRef.current =
        transcript.length > 0 ? transcript[transcript.length - 1].turn_id : 0;
      return;
    }

    const newEntries = transcript.filter(
      (entry) => entry.turn_id > lastProcessedTurnIdRef.current
    );
    if (newEntries.length === 0) return;

    lastProcessedTurnIdRef.current = newEntries[newEntries.length - 1].turn_id;

    if (muted || roomStatus !== "running") {
      return;
    }

    for (const entry of newEntries) {
      if (!entry.is_ai || !entry.text.trim()) continue;
      const member = participants?.find((p) => p.id === entry.participant_id);
      queueRef.current.push({
        turnId: entry.turn_id,
        participantId: entry.participant_id,
        text: entry.text,
        audioUrl: entry.audio_url,
        personaKey: member?.persona?.key ?? null,
      });
    }

    playNext();
  }, [transcript, participants, roomStatus, welcomeCount, muted, playNext]);

  const enableAudio = useCallback(() => {
    unlockAudio();
    setAutoplayBlocked(false);
    setVoiceNotice(null);
    playNext();
  }, [playNext]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (!next) {
        unlockAudio();
        setAutoplayBlocked(false);
      } else {
        stopActivePlayback(true);
      }
      return next;
    });
  }, [stopActivePlayback]);

  const testVoice = useCallback(async () => {
    unlockAudio();
    setVoiceNotice(null);
    setAutoplayBlocked(false);
    stopActivePlayback(false);
    setTestingVoice(true);

    try {
      const blob = await fetchTestVoice("en-IN-NeerjaNeural");
      const url = URL.createObjectURL(blob);
      activeTestUrlRef.current = url;
      const audio = new Audio(url);
      activeAudioRef.current = audio;

      const cleanupTest = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
        if (activeTestUrlRef.current === url) {
          URL.revokeObjectURL(url);
          activeTestUrlRef.current = null;
        }
        setTestingVoice(false);
      };

      audio.onended = cleanupTest;
      audio.onerror = () => {
        console.error("[GDArena Audio] Test voice playback failed:", audio.error);
        setVoiceNotice("Could not play test audio clip in browser.");
        cleanupTest();
      };

      await audio.play();
    } catch (err) {
      console.error("[GDArena Audio] Test voice error:", err);
      const errName =
        err instanceof DOMException
          ? err.name
          : err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      if (errName === "NotAllowedError") {
        setAutoplayBlocked(true);
      } else if (err instanceof ApiError) {
        setVoiceNotice(err.message);
      } else {
        setVoiceNotice("Test voice failed. Check backend logs and network.");
      }
      if (activeTestUrlRef.current) {
        URL.revokeObjectURL(activeTestUrlRef.current);
        activeTestUrlRef.current = null;
      }
      activeAudioRef.current = null;
      setTestingVoice(false);
    }
  }, [stopActivePlayback]);

  const clearVoiceNotice = useCallback(() => {
    setVoiceNotice(null);
  }, []);

  return {
    muted,
    toggleMute,
    autoplayBlocked,
    enableAudio,
    testVoice,
    testingVoice,
    voiceNotice,
    clearVoiceNotice,
    aiSpeakingParticipantId,
  };
}
