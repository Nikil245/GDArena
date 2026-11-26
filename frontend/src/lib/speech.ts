/**
 * Browser audio unlock + optional Web Speech API fallback helpers.
 * All browser globals are strictly guarded for SSR safety.
 */

import { resumeAudioAnalyserContext } from "./audioLevel";

export interface PersonaVoiceProfile {
  voiceIndexOffset: number;
  pitch: number;
  rate: number;
}

const PERSONA_PROFILES: Record<string, PersonaVoiceProfile> = {
  aggressive_debater: { voiceIndexOffset: 0, pitch: 0.92, rate: 1.08 },
  calm_analyst: { voiceIndexOffset: 1, pitch: 1.0, rate: 0.94 },
  data_driven: { voiceIndexOffset: 2, pitch: 0.98, rate: 1.02 },
  empathetic: { voiceIndexOffset: 3, pitch: 1.1, rate: 0.97 },
  devils_advocate: { voiceIndexOffset: 4, pitch: 0.95, rate: 1.05 },
  visionary: { voiceIndexOffset: 5, pitch: 1.06, rate: 1.02 },
  pragmatist: { voiceIndexOffset: 6, pitch: 0.94, rate: 0.98 },
  storyteller: { voiceIndexOffset: 7, pitch: 1.08, rate: 0.96 },
  consensus_builder: { voiceIndexOffset: 8, pitch: 1.02, rate: 0.95 },
  questioner: { voiceIndexOffset: 9, pitch: 1.05, rate: 1.04 },
};

const PREFERRED_LANG_ORDER = ["en-in", "en-gb", "en-us"];

// Tiny 44-byte silent PCM WAV clip to unlock HTMLAudioElement autoplay on user gesture.
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

let speechUnlocked = false;
let audioUnlocked = false;

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function hasSpeechSynthesisVoices(): boolean {
  if (!isSpeechSupported()) return false;
  try {
    return window.speechSynthesis.getVoices().length > 0;
  } catch {
    return false;
  }
}

export function unlockSpeech(): void {
  if (!isSpeechSupported()) return;
  try {
    const synth = window.speechSynthesis;
    synth.resume();
    if (!speechUnlocked) {
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      primer.rate = 2;
      synth.speak(primer);
      speechUnlocked = true;
    }
  } catch {
    // Ignore autoplay errors
  }
}

/**
 * Call inside a user click/submit handler (Join, Start, Raise Hand, Unmute, Test Voice)
 * so Chrome/Brave/Safari allow subsequent automatic HTMLAudioElement playback.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (!audioUnlocked && typeof Audio !== "undefined") {
    try {
      const silent = new Audio(SILENT_WAV_DATA_URI);
      silent.volume = 0;
      const playPromise = silent.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            audioUnlocked = true;
          })
          .catch(() => {
            // Browser may still block until next gesture; handled gracefully during playback
          });
      } else {
        audioUnlocked = true;
      }
    } catch {
      // Ignore
    }
  }
  unlockSpeech();
  resumeAudioAnalyserContext();
}

export function pickEnglishVoices(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice[] {
  const english = voices.filter((v) =>
    v.lang.toLowerCase().startsWith("en")
  );
  const pool = english.length > 0 ? english : voices;

  return [...pool].sort((a, b) => {
    const aLang = a.lang.toLowerCase();
    const bLang = b.lang.toLowerCase();
    const aRank = PREFERRED_LANG_ORDER.findIndex((p) => aLang.startsWith(p));
    const bRank = PREFERRED_LANG_ORDER.findIndex((p) => bLang.startsWith(p));
    const aScore = aRank === -1 ? 99 : aRank;
    const bScore = bRank === -1 ? 99 : bRank;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}

export function getPersonaVoiceSettings(
  personaKey: string | null | undefined,
  participantId: number,
  englishVoices: SpeechSynthesisVoice[]
): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
  const profile = (personaKey && PERSONA_PROFILES[personaKey]) || {
    voiceIndexOffset: Math.abs(participantId),
    pitch: 1.0,
    rate: 1.0,
  };
  const voice =
    englishVoices.length > 0
      ? englishVoices[profile.voiceIndexOffset % englishVoices.length]
      : null;
  return {
    voice,
    pitch: profile.pitch,
    rate: profile.rate,
  };
}
