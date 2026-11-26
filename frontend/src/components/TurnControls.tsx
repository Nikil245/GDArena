"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Hand,
  Loader2,
  Mic,
  Send,
  SkipForward,
  Square,
} from "lucide-react";
import { ApiError, transcribeAudio } from "@/lib/api";
import { connectMicStream } from "@/lib/audioLevel";
import { formatSeconds } from "@/lib/format";
import { unlockAudio } from "@/lib/speech";
import type { Participant, QueueItem, Speaker } from "@/lib/types";

interface TurnControlsProps {
  you: Participant | null;
  currentSpeaker: Speaker | null;
  queue: QueueItem[];
  turnRemainingSeconds: number | null;
  disabled: boolean;
  onRecordingChange?: (recording: boolean) => void;
  onRaiseHand: () => void;
  onLowerHand: () => void;
  onSubmitTurn: (text: string, source?: "text" | "voice") => void;
  onYieldTurn: () => void;
}

const MAX_TURN_CHARS = 2000;
const MIN_AUDIO_BYTES = 200;

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

export function TurnControls({
  you,
  currentSpeaker,
  queue,
  turnRemainingSeconds,
  disabled,
  onRecordingChange,
  onRaiseHand,
  onLowerHand,
  onSubmitTurn,
  onYieldTurn,
}: TurnControlsProps) {
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micDisconnectRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardOnStopRef = useRef(false);

  const isMyTurn = Boolean(
    you && currentSpeaker !== null && currentSpeaker.participant_id === you.id
  );
  const myQueueIndex = you
    ? queue.findIndex((q) => q.participant_id === you.id)
    : -1;
  const isHandRaised = myQueueIndex !== -1;

  const stopStreamTracks = useCallback(() => {
    if (micDisconnectRef.current) {
      micDisconnectRef.current();
      micDisconnectRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Notify parent when recording state changes
  useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording, onRecordingChange]);

  // Recording elapsed timer
  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }
    const id = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      discardOnStopRef.current = true;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          // Ignore
        }
      }
      stopStreamTracks();
    };
  }, [stopStreamTracks]);

  // Abort recording cleanly if the floor leaves this player (e.g. skipped or GD ended)
  useEffect(() => {
    if (!isMyTurn && recording) {
      discardOnStopRef.current = true;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          // Ignore
        }
      }
      setRecording(false);
      stopStreamTracks();
    }
  }, [isMyTurn, recording, stopStreamTracks]);

  // Auto-stop and submit just before per-turn timer expires
  useEffect(() => {
    if (
      recording &&
      isMyTurn &&
      turnRemainingSeconds !== null &&
      turnRemainingSeconds <= 1
    ) {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        discardOnStopRef.current = false;
        rec.stop();
      }
    }
  }, [recording, isMyTurn, turnRemainingSeconds]);

  const stopAndSubmitRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      discardOnStopRef.current = false;
      rec.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!isMyTurn || disabled || transcribing || recording) return;
    unlockAudio();
    setVoiceError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceError(
        "Microphone recording is not supported in this browser. Use text input instead."
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setVoiceError(
          "Microphone permission was denied. Allow mic access in your browser settings or use text instead."
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setVoiceError(
          "No microphone was found on this device. Connect a mic or use text instead."
        );
      } else {
        setVoiceError("Could not access your microphone.");
      }
      return;
    }

    streamRef.current = stream;
    micDisconnectRef.current = connectMicStream(stream);
    chunksRef.current = [];
    discardOnStopRef.current = false;

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      stopStreamTracks();
      setVoiceError("Could not initialise audio recorder in this browser.");
      return;
    }

    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunksRef.current.push(ev.data);
      }
    };

    recorder.onstop = async () => {
      setRecording(false);
      stopStreamTracks();
      recorderRef.current = null;

      if (discardOnStopRef.current) {
        chunksRef.current = [];
        return;
      }

      const blobType = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];

      if (blob.size < MIN_AUDIO_BYTES) {
        setVoiceError("Recording was empty. Click the microphone and speak clearly.");
        return;
      }

      setTranscribing(true);
      setVoiceError(null);
      try {
        const res = await transcribeAudio(blob, "en");
        const cleaned = res.text.trim();
        if (!cleaned) {
          setVoiceError("No speech detected. Please try speaking again.");
          return;
        }
        onSubmitTurn(cleaned, "voice");
      } catch (err) {
        if (err instanceof ApiError) {
          setVoiceError(err.message);
        } else {
          setVoiceError("Transcription failed. Please try again.");
        }
      } finally {
        setTranscribing(false);
      }
    };

    recorder.start(250);
    setRecording(true);
  }, [isMyTurn, disabled, transcribing, recording, stopStreamTracks, onSubmitTurn]);

  if (!you) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        You are viewing this discussion as a read-only spectator.
      </section>
    );
  }

  if (you.role === "moderator") {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
        You joined as <span className="font-medium text-slate-900">Moderator</span>. Use the
        Moderator Panel to manage the discussion, skip turns, and adjust scores.
      </section>
    );
  }

  const submitDebugText = () => {
    const trimmed = text.trim();
    if (!trimmed || !isMyTurn || disabled) return;
    onSubmitTurn(trimmed, "text");
    setText("");
  };

  const handleTextSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitDebugText();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitDebugText();
    }
  };

  const handleRaiseHand = () => {
    unlockAudio();
    onRaiseHand();
  };

  return (
    <section
      className={`rounded-md border bg-white p-4 transition-colors duration-150 ${
        isMyTurn ? "border-blue-800" : "border-slate-200"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              isMyTurn ? "text-blue-800" : "text-slate-900"
            }`}
          >
            {isMyTurn
              ? "Your turn to speak"
              : isHandRaised
              ? `Hand raised — position #${myQueueIndex + 1} in queue`
              : "Your Floor Controls"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isMyTurn ? (
            <button
              type="button"
              onClick={onYieldTurn}
              disabled={disabled || recording || transcribing}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5" strokeWidth={1.75} />
              Yield Turn
            </button>
          ) : isHandRaised ? (
            <button
              type="button"
              onClick={onLowerHand}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Hand className="h-3.5 w-3.5" strokeWidth={1.75} />
              Lower Hand (#{myQueueIndex + 1})
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRaiseHand}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded border border-blue-800 bg-blue-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Hand className="h-3.5 w-3.5" strokeWidth={1.75} />
              Raise Hand
            </button>
          )}
        </div>
      </div>

      {voiceError && (
        <div className="mb-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>{voiceError}</span>
        </div>
      )}

      {!textMode ? (
        <div className="space-y-3">
          {recording ? (
            <button
              type="button"
              onClick={stopAndSubmitRecording}
              className="flex w-full items-center justify-center gap-3 rounded-md border border-red-800 bg-red-700 px-5 py-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-red-800"
            >
              <Square className="h-5 w-5" strokeWidth={2} />
              <span className="tabular-nums">
                Recording... {formatSeconds(recordingSeconds)} — Click to Stop & Submit
              </span>
            </button>
          ) : transcribing ? (
            <button
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-md border border-slate-300 bg-slate-100 px-5 py-4 text-sm font-semibold text-slate-700"
            >
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
              <span>Transcribing...</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={!isMyTurn || disabled}
              className={`flex w-full items-center justify-center gap-3 rounded-md border px-5 py-4 text-sm font-semibold transition-colors duration-150 ${
                isMyTurn && !disabled
                  ? "border-blue-800 bg-blue-800 text-white hover:bg-blue-900"
                  : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
              }`}
            >
              <Mic className="h-5 w-5" strokeWidth={2} />
              <span>
                {isMyTurn
                  ? "Click to Speak (Microphone)"
                  : "Raise your hand and wait for your turn to speak"}
              </span>
            </button>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {isMyTurn
                ? "Click to start recording, click again when done."
                : "Microphone unlocks automatically when you have the floor."}
            </span>
            <button
              type="button"
              onClick={() => setTextMode(true)}
              className="shrink-0 text-xs font-medium text-slate-500 underline underline-offset-2 transition-colors duration-150 hover:text-slate-800"
            >
              Use text instead
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleTextSubmit} className="space-y-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TURN_CHARS))}
            onKeyDown={handleKeyDown}
            disabled={!isMyTurn || disabled}
            rows={2}
            placeholder={
              isMyTurn
                ? "Debug text input: type your point and press Enter..."
                : "Raise your hand and wait for the floor to submit."
            }
            className="w-full resize-none rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-800 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setTextMode(false)}
              className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
            >
              Use microphone
            </button>
            <button
              type="submit"
              disabled={!isMyTurn || disabled || text.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded bg-blue-800 px-4 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              Submit Turn
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
