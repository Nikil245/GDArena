/**
 * Web Audio API AnalyserNode helpers for driving real-time 3D mouth animations
 * without causing React re-renders. Browser-only & strictly SSR-safe.
 */

let sharedCtx: AudioContext | null = null;
let aiAnalyser: AnalyserNode | null = null;
let aiBuf: Uint8Array<ArrayBuffer> | null = null;
let aiSourceNode: MediaElementAudioSourceNode | null = null;
let aiActive = false;

let micAnalyser: AnalyserNode | null = null;
let micBuf: Uint8Array<ArrayBuffer> | null = null;
let micSourceNode: MediaStreamAudioSourceNode | null = null;
let micActive = false;

function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;

  const AudioCtxCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtxCtor) return null;

  try {
    sharedCtx = new AudioCtxCtor();
    return sharedCtx;
  } catch {
    return null;
  }
}

export function resumeAudioAnalyserContext(): void {
  const ctx = ensureAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {
      // Autoplay policies may still defer until the next user gesture
    });
  }
}

export function connectAiAudioElement(audio: HTMLAudioElement): () => void {
  const src = audio.src || audio.currentSrc || "";
  const safeOrigin =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    audio.crossOrigin === "anonymous";
  if (!safeOrigin) {
    return () => {};
  }

  const ctx = ensureAudioContext();
  if (!ctx) {
    return () => {};
  }

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {
      // Autoplay policies may keep context suspended until user gesture
    });
  }

  if (ctx.state !== "running") {
    // Do not hijack HTMLAudioElement output with MediaElementAudioSourceNode
    // while AudioContext is suspended; timed fallback drives mouth motion.
    return () => {};
  }

  if (!aiAnalyser) {
    aiAnalyser = ctx.createAnalyser();
    aiAnalyser.fftSize = 256;
    aiAnalyser.smoothingTimeConstant = 0.65;
    aiBuf = new Uint8Array(aiAnalyser.frequencyBinCount);
    aiAnalyser.connect(ctx.destination);
  }

  if (aiSourceNode) {
    try {
      aiSourceNode.disconnect();
    } catch {
      // Ignore disconnect errors on stale nodes
    }
    aiSourceNode = null;
  }

  let createdSource: MediaElementAudioSourceNode;
  try {
    createdSource = ctx.createMediaElementSource(audio);
    createdSource.connect(aiAnalyser);
    aiSourceNode = createdSource;
    aiActive = true;
    resumeAudioAnalyserContext();
  } catch {
    aiActive = false;
    return () => {};
  }

  return () => {
    try {
      createdSource.disconnect();
    } catch {
      // Ignore
    }
    if (aiSourceNode === createdSource) {
      aiSourceNode = null;
      aiActive = false;
    }
  };
}

export function connectMicStream(stream: MediaStream): () => void {
  const ctx = ensureAudioContext();
  if (!ctx) {
    return () => {};
  }

  if (!micAnalyser) {
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.65;
    micBuf = new Uint8Array(micAnalyser.frequencyBinCount);
    // Intentionally NOT connected to ctx.destination to avoid microphone feedback.
  }

  if (micSourceNode) {
    try {
      micSourceNode.disconnect();
    } catch {
      // Ignore
    }
    micSourceNode = null;
  }

  let createdSource: MediaStreamAudioSourceNode;
  try {
    createdSource = ctx.createMediaStreamSource(stream);
    createdSource.connect(micAnalyser);
    micSourceNode = createdSource;
    micActive = true;
    resumeAudioAnalyserContext();
  } catch {
    micActive = false;
    return () => {};
  }

  return () => {
    try {
      createdSource.disconnect();
    } catch {
      // Ignore
    }
    if (micSourceNode === createdSource) {
      micSourceNode = null;
      micActive = false;
    }
  };
}

export function sampleAudioLevel(kind: "ai" | "mic"): {
  level: number;
  available: boolean;
} {
  if (!sharedCtx || sharedCtx.state !== "running") {
    return { level: 0, available: false };
  }

  const active = kind === "ai" ? aiActive : micActive;
  const analyser = kind === "ai" ? aiAnalyser : micAnalyser;
  const buf = kind === "ai" ? aiBuf : micBuf;

  if (!active || !analyser || !buf) {
    return { level: 0, available: false };
  }

  analyser.getByteTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const sample = (buf[i] - 128) / 128;
    sumSq += sample * sample;
  }
  const rms = Math.sqrt(sumSq / buf.length);
  const gated = Math.max(0, rms - 0.012);
  const normalized = Math.min(1, gated / 0.16);
  return { level: normalized, available: true };
}

