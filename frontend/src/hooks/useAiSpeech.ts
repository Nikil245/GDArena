"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchTestVoice, resolveApiUrl } from "@/lib/api";
import {
  connectAiAudioElement,
  resumeAudioAnalyserContext,
} from "@/lib/audioLevel";
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
  receivedPerf: number;
  preloadedBlobUrl: string | null;
  preloadPromise: Promise<string | null> | null;
}

export interface UseAiSpeechOptions {
  transcript: TranscriptEntry[] | undefined;
  participants: Participant[] | undefined;
  roomStatus: RoomStatus | undefined;
  welcomeCount: number;
  isHumanRecording: boolean;
  onPlaybackEnded?: (turnId: number) => void;
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

function revokeItemBlob(item: QueuedSpeechItem): void {
  if (item.preloadedBlobUrl) {
    URL.revokeObjectURL(item.preloadedBlobUrl);
    item.preloadedBlobUrl = null;
  }
}

export function useAiSpeech({
  transcript,
  participants,
  roomStatus,
  welcomeCount,
  isHumanRecording,
  onPlaybackEnded,
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
  const activeBlobUrlRef = useRef<string | null>(null);
  const activeTestUrlRef = useRef<string | null>(null);
  const aiAudioDisconnectRef = useRef<(() => void) | null>(null);
  const mutedRef = useRef(muted);
  const roomStatusRef = useRef(roomStatus);
  const humanRecordingRef = useRef(isHumanRecording);
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  const lastWelcomeCountRef = useRef<number>(0);
  const lastProcessedTurnIdRef = useRef<number>(0);
  const lastAudioEndedPerfRef = useRef<number | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  mutedRef.current = muted;
  roomStatusRef.current = roomStatus;
  humanRecordingRef.current = isHumanRecording;
  onPlaybackEndedRef.current = onPlaybackEnded;

  const disconnectAiAnalyser = useCallback(() => {
    if (aiAudioDisconnectRef.current) {
      aiAudioDisconnectRef.current();
      aiAudioDisconnectRef.current = null;
    }
  }, []);

  const stopActivePlayback = useCallback((clearQueue: boolean) => {
    disconnectAiAnalyser();
    if (clearQueue) {
      for (const item of queueRef.current) {
        revokeItemBlob(item);
      }
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
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
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
  }, [disconnectAiAnalyser]);

  // Load browser speechSynthesis voices asynchronously (fallback only)
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

  const speakWithFallback = useCallback((item: QueuedSpeechItem): boolean => {
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
      lastAudioEndedPerfRef.current = performance.now();
      playingRef.current = false;
      setAiSpeakingParticipantId(null);
      onPlaybackEndedRef.current?.(item.turnId);
      playNextRef.current();
    };
    utterance.onerror = (ev) => {
      console.error("[GDArena Audio] Fallback speechSynthesis error:", ev);
      lastAudioEndedPerfRef.current = performance.now();
      playingRef.current = false;
      setAiSpeakingParticipantId(null);
      onPlaybackEndedRef.current?.(item.turnId);
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
  }, []);

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

    const startAudioClip = async () => {
      if (!nextItem.audioUrl) {
        if (speakWithFallback(nextItem)) {
          return;
        }
        playingRef.current = false;
        setAiSpeakingParticipantId(null);
        onPlaybackEndedRef.current?.(nextItem.turnId);
        playNextRef.current();
        return;
      }

      const fullUrl = resolveApiUrl(nextItem.audioUrl);
      let playSrc = fullUrl;
      let blobUrl: string | null = nextItem.preloadedBlobUrl;

      if (!blobUrl && nextItem.preloadPromise) {
        try {
          blobUrl = await nextItem.preloadPromise;
        } catch {
          blobUrl = null;
        }
      }

      if (
        mutedRef.current ||
        roomStatusRef.current !== "running" ||
        humanRecordingRef.current
      ) {
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          nextItem.preloadedBlobUrl = null;
        }
        playingRef.current = false;
        return;
      }

      if (blobUrl) {
        playSrc = blobUrl;
        activeBlobUrlRef.current = blobUrl;
        nextItem.preloadedBlobUrl = null;
      }

      const audio = new Audio();
      if (!playSrc.startsWith("blob:") && !playSrc.startsWith("data:")) {
        audio.crossOrigin = "anonymous";
      }
      audio.src = playSrc;
      activeAudioRef.current = audio;
      disconnectAiAnalyser();
      aiAudioDisconnectRef.current = connectAiAudioElement(audio);

      const finishAndAdvance = (fallback: boolean, reportEnd: boolean) => {
        if (activeAudioRef.current !== audio) return;
        disconnectAiAnalyser();
        activeAudioRef.current = null;
        if (activeBlobUrlRef.current) {
          URL.revokeObjectURL(activeBlobUrlRef.current);
          activeBlobUrlRef.current = null;
        }
        if (fallback && !mutedRef.current && !humanRecordingRef.current) {
          if (speakWithFallback(nextItem)) {
            return;
          }
        }
        lastAudioEndedPerfRef.current = performance.now();
        playingRef.current = false;
        setAiSpeakingParticipantId(null);
        if (reportEnd) {
          onPlaybackEndedRef.current?.(nextItem.turnId);
        }
        playNextRef.current();
      };

      audio.onplaying = () => {
        if (activeAudioRef.current !== audio) return;
        resumeAudioAnalyserContext();
        const nowPerf = performance.now();
        const prevEnd = lastAudioEndedPerfRef.current;
        const totalGap = prevEnd !== null ? nowPerf - prevEnd : null;
        const entryToPlay = nowPerf - nextItem.receivedPerf;
        console.debug(
          `[GDArena Timing] turn=${nextItem.turnId} entry->playing=${entryToPlay.toFixed(0)}ms` +
            (totalGap !== null
              ? ` prev_end->playing=${totalGap.toFixed(0)}ms`
              : "")
        );
        setAutoplayBlocked(false);
        setAiSpeakingParticipantId(nextItem.participantId);
      };
      audio.onended = () => finishAndAdvance(false, true);
      audio.onerror = () => {
        console.error(
          "[GDArena Audio] HTMLAudioElement error loading/playing:",
          fullUrl,
          audio.error
        );
        finishAndAdvance(true, true);
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
              disconnectAiAnalyser();
              activeAudioRef.current = null;
              if (blobUrl) {
                nextItem.preloadedBlobUrl = blobUrl;
                activeBlobUrlRef.current = null;
              }
              playingRef.current = false;
              setAiSpeakingParticipantId(null);
              setAutoplayBlocked(true);
              queueRef.current.unshift(nextItem);
              return;
            }
            console.error("[GDArena Audio] audio.play() rejected:", err);
            finishAndAdvance(true, true);
          });
        }
      } catch (err) {
        console.error("[GDArena Audio] Synchronous audio.play() error:", err);
        finishAndAdvance(true, true);
      }
    };

    void startAudioClip();
  }, [disconnectAiAnalyser, speakWithFallback]);

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

  // Enqueue & preload ONLY newly arriving AI turns (never replay old turns on load or reconnect)
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

    const receivedPerf = performance.now();
    for (const entry of newEntries) {
      if (!entry.is_ai || !entry.text.trim()) continue;
      const member = participants?.find((p) => p.id === entry.participant_id);
      const item: QueuedSpeechItem = {
        turnId: entry.turn_id,
        participantId: entry.participant_id,
        text: entry.text,
        audioUrl: entry.audio_url,
        personaKey: member?.persona?.key ?? null,
        receivedPerf,
        preloadedBlobUrl: null,
        preloadPromise: null,
      };
      if (entry.audio_url) {
        const fullUrl = resolveApiUrl(entry.audio_url);
        item.preloadPromise = fetch(fullUrl, { cache: "no-store" })
          .then(async (res) => {
            if (!res.ok) return null;
            const rawBlob = await res.blob();
            const headerType = res.headers
              .get("content-type")
              ?.split(";")[0]
              .trim();
            const inferredType =
              headerType ||
              (fullUrl.toLowerCase().endsWith(".wav")
                ? "audio/wav"
                : "audio/mpeg");
            return rawBlob.type === inferredType
              ? rawBlob
              : new Blob([rawBlob], { type: inferredType });
          })
          .then((blob) => {
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            item.preloadedBlobUrl = url;
            return url;
          })
          .catch(() => null);
      }
      queueRef.current.push(item);
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
      const blob = await fetchTestVoice();
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
