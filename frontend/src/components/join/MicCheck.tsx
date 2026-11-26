"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mic, Square } from "lucide-react";

type MicStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "working"
  | "no_sound"
  | "error";

const SOUND_THRESHOLD_RMS = 0.02;
const SILENCE_TIMEOUT_MS = 5000;

function mapMicError(err: unknown): { message: string; hint: string } {
  const name =
    err instanceof DOMException
      ? err.name
      : err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      message: "Microphone permission was denied.",
      hint: "Click the lock or microphone icon in your browser address bar, allow microphone access, and try again.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      message: "No microphone was found on this device.",
      hint: "Connect a microphone or check your system sound input settings, then retry.",
    };
  }
  if (name === "SecurityError") {
    return {
      message: "Microphone access requires a secure browser context.",
      hint: "Open this page over HTTPS or localhost and allow microphone access in the address bar.",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      message: "Your microphone is currently in use by another application.",
      hint: "Close other apps using the microphone and try again.",
    };
  }
  return {
    message: "Could not access your microphone.",
    hint: "Check microphone permissions in your browser address bar and verify your input device.",
  };
}

export function MicCheck() {
  const [status, setStatus] = useState<MicStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const statusRef = useRef<MicStatus>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectedSoundRef = useRef(false);
  const meterBarRef = useRef<HTMLDivElement>(null);

  statusRef.current = status;

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // Ignore
      }
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      void ctx.close().catch(() => {});
    }
    if (meterBarRef.current) {
      meterBarRef.current.style.width = "0%";
    }
    detectedSoundRef.current = false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const stopTest = useCallback(() => {
    cleanupAudio();
    setStatus("idle");
    setErrorMessage(null);
    setErrorHint(null);
  }, [cleanupAudio]);

  const startTest = useCallback(async () => {
    cleanupAudio();
    setErrorMessage(null);
    setErrorHint(null);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("error");
      setErrorMessage("Microphone check requires a secure connection.");
      setErrorHint(
        "Open this page over HTTPS or localhost and allow microphone access in the browser address bar."
      );
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus("error");
      setErrorMessage("Microphone access is not supported in this browser.");
      setErrorHint(
        "Use a modern browser over HTTPS or localhost and check site permissions in the address bar."
      );
      return;
    }

    setStatus("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (!mountedRef.current) return;
      const mapped = mapMicError(err);
      setStatus("error");
      setErrorMessage(mapped.message);
      setErrorHint(mapped.hint);
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioCtxCtor) {
      stream.getTracks().forEach((track) => track.stop());
      setStatus("error");
      setErrorMessage("Web Audio API is unavailable in this browser.");
      setErrorHint("Try a current version of Chrome, Edge, Firefox, or Safari.");
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioCtxCtor();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      if (!mountedRef.current) return;
      setStatus("error");
      setErrorMessage("Could not start audio input analyser.");
      setErrorHint(
        "Check your browser audio settings or microphone permissions in the address bar."
      );
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close().catch(() => {});
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    streamRef.current = stream;
    audioCtxRef.current = ctx;
    sourceRef.current = source;
    analyserRef.current = analyser;
    detectedSoundRef.current = false;

    setStatus("listening");
    statusRef.current = "listening";

    silenceTimerRef.current = setTimeout(() => {
      if (mountedRef.current && !detectedSoundRef.current) {
        setStatus("no_sound");
      }
    }, SILENCE_TIMEOUT_MS);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const sample = () => {
      if (!mountedRef.current || !analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(dataArray);
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const v = (dataArray[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      const pct = Math.min(100, Math.round((Math.max(0, rms - 0.008) / 0.16) * 100));

      if (meterBarRef.current) {
        meterBarRef.current.style.width = `${pct}%`;
      }

      if (rms > SOUND_THRESHOLD_RMS && !detectedSoundRef.current) {
        detectedSoundRef.current = true;
        if (silenceTimerRef.current !== null) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        if (statusRef.current !== "working") {
          setStatus("working");
        }
      }

      rafRef.current = requestAnimationFrame(sample);
    };

    rafRef.current = requestAnimationFrame(sample);
  }, [cleanupAudio]);

  const isActive =
    status === "listening" || status === "working" || status === "no_sound";

  return (
    <section className="ui-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-card-title font-semibold text-ink">
            <Mic className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Microphone Check
          </h2>
          <p className="mt-1 text-caption text-ink-muted">
            Verify your input device before entering the room.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {isActive || status === "requesting" ? (
          <button
            type="button"
            onClick={stopTest}
            className="ui-btn-secondary w-full"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} />
            Stop test
          </button>
        ) : (
          <button
            type="button"
            onClick={startTest}
            className="ui-btn-secondary w-full"
          >
            <Mic className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Test microphone
          </button>
        )}

        {isActive && (
          <div className="space-y-2">
            <div
              aria-hidden="true"
              className="h-2.5 w-full overflow-hidden rounded-chip border border-line bg-muted"
            >
              <div
                ref={meterBarRef}
                className="h-full bg-accent"
                style={{ width: "0%" }}
              />
            </div>

            <div aria-live="polite" className="min-h-[20px] text-caption">
              {status === "listening" && (
                <p className="text-ink-muted">
                  Listening — speak a few words to test your microphone.
                </p>
              )}
              {status === "working" && (
                <p className="flex items-center gap-1.5 font-semibold text-success-text">
                  <CheckCircle2
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span>Microphone working</span>
                </p>
              )}
              {status === "no_sound" && (
                <p className="flex items-center gap-1.5 font-medium text-danger-text">
                  <AlertCircle
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span>No sound detected, check your input device</span>
                </p>
              )}
            </div>
          </div>
        )}

        {status === "requesting" && (
          <p aria-live="polite" className="text-caption text-ink-muted">
            Waiting for browser microphone permission...
          </p>
        )}

        {status === "error" && errorMessage && (
          <div
            role="alert"
            className="rounded-control border border-danger-border bg-danger-bg px-3 py-2.5 text-caption text-danger-text"
          >
            <p className="flex items-start gap-1.5 font-semibold">
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
              />
              <span>{errorMessage}</span>
            </p>
            {errorHint && <p className="mt-1 pl-5">{errorHint}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

