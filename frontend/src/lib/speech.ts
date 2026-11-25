/**
 * Browser Web Speech API (speechSynthesis) utilities for AI participant voices.
 * All browser globals are strictly guarded for SSR safety.
 */

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

let speechUnlocked = false;

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * Call inside a user click/submit handler (Join, Start, Raise Hand, Unmute)
 * so Chrome/Safari allow subsequent automatic AI speechSynthesis utterances.
 */
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

