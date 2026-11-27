"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, PauseCircle } from "lucide-react";
import { fetchServiceStatus } from "@/lib/api";
import {
  formatEstimatedResume,
  type RoomServiceBannerState,
} from "@/lib/serviceStatus";
import { useBackendStatus } from "./BackendStatusProvider";

const COUNTDOWN_REFRESH_MS = 30_000;
const BACK_NOTICE_FADE_MS = 4_600;
const BACK_NOTICE_HIDE_MS = 5_000;

interface RoomServiceStatusBannerProps {
  serviceStatus: RoomServiceBannerState;
  canModerate: boolean;
  disabled: boolean;
  onContinueWithoutAi: () => void;
  onEndSession: () => void;
  onDismissBackNotice: () => void;
}

export function RoomServiceStatusBanner({
  serviceStatus,
  canModerate,
  disabled,
  onContinueWithoutAi,
  onEndSession,
  onDismissBackNotice,
}: RoomServiceStatusBannerProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [fadingBack, setFadingBack] = useState(false);

  const isExhausted = serviceStatus.llmState === "exhausted";
  const showBack = !isExhausted && serviceStatus.showBackNotice;

  // Refresh the approximate countdown every 30 seconds while exhausted with a retry_at
  useEffect(() => {
    if (!isExhausted || !serviceStatus.retryAt) return;
    setNowMs(Date.now());
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, COUNTDOWN_REFRESH_MS);
    return () => clearInterval(id);
  }, [isExhausted, serviceStatus.retryAt]);

  // Auto-fade and dismiss the "AI participants are back" notice after 5 seconds
  useEffect(() => {
    if (!showBack) {
      setFadingBack(false);
      return;
    }
    setFadingBack(false);
    const fadeTimer = setTimeout(() => setFadingBack(true), BACK_NOTICE_FADE_MS);
    const hideTimer = setTimeout(() => {
      onDismissBackNotice();
    }, BACK_NOTICE_HIDE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [showBack, onDismissBackNotice]);

  if (showBack) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 rounded-card border border-success-border bg-success-bg px-4 py-2.5 text-sm font-medium text-success-text transition-opacity duration-300 motion-reduce:transition-none ${
          fadingBack ? "opacity-0" : "opacity-100"
        }`}
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>AI participants are back</span>
      </div>
    );
  }

  if (!isExhausted) {
    return null;
  }

  const estimate = formatEstimatedResume(serviceStatus.retryAt, nowMs);

  // Collapsed slim bar after moderator chooses "Continue without AI"
  if (serviceStatus.continueWithoutAi) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-amber-300 bg-amber-50 px-3.5 py-2 text-caption text-amber-950"
      >
        <div className="flex min-w-0 items-center gap-2">
          <PauseCircle
            className="h-4 w-4 shrink-0 text-amber-800"
            strokeWidth={1.75}
          />
          <span className="font-medium">
            Continuing without AI — AI participants are paused.
            {estimate ? ` ${estimate}.` : ""}
          </span>
        </div>
        {canModerate && (
          <button
            type="button"
            onClick={onEndSession}
            disabled={disabled}
            className="ui-btn-destructive min-h-[32px] px-2.5 py-1 text-xs"
          >
            End session
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-card"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-800"
            strokeWidth={1.75}
          />
          <div className="min-w-0 space-y-1">
            <p className="font-medium leading-snug">
              AI services have reached their usage limit. AI participants are
              paused, so you can continue with the other participants or end the
              session.
            </p>
            {estimate && (
              <p className="text-caption text-amber-900">{estimate}.</p>
            )}
          </div>
        </div>

        {canModerate && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onContinueWithoutAi}
              disabled={disabled}
              className="ui-focus inline-flex min-h-[36px] items-center justify-center rounded-control border border-amber-400 bg-surface px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors duration-150 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue without AI
            </button>
            <button
              type="button"
              onClick={onEndSession}
              disabled={disabled}
              className="ui-btn-destructive min-h-[36px] px-3 py-1.5 text-xs"
            >
              End session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Pre-start notice shown above the Setup and Join forms when GET /status
 * reports that LLM quota is exhausted. Waits until the backend is awake so it
 * never triggers the Render waking-up overlay by itself; silently hides on error.
 */
export function PreStartLimitNotice() {
  const { status: backendStatus } = useBackendStatus();
  const [exhausted, setExhausted] = useState(false);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (backendStatus !== "awake" || fetchedRef.current) return;
    let cancelled = false;

    void fetchServiceStatus()
      .then((res) => {
        if (cancelled) return;
        fetchedRef.current = true;
        if (res.llm === "exhausted") {
          setExhausted(true);
          setRetryAt(res.retry_at ?? null);
          setNowMs(Date.now());
        } else {
          setExhausted(false);
          setRetryAt(null);
        }
      })
      .catch(() => {
        // If /status fails, assume ok and show nothing.
      });

    return () => {
      cancelled = true;
    };
  }, [backendStatus]);

  useEffect(() => {
    if (!exhausted || !retryAt) return;
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, COUNTDOWN_REFRESH_MS);
    return () => clearInterval(id);
  }, [exhausted, retryAt]);

  if (!exhausted) return null;

  const estimate = formatEstimatedResume(retryAt, nowMs);

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-start gap-2.5 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-800"
        strokeWidth={1.75}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="leading-snug">
          AI participants are temporarily unavailable because the usage limit
          was reached. You can still create a room, but AI participants will not
          speak until it resets.
        </p>
        {estimate && (
          <p className="text-caption font-medium text-amber-900">
            {estimate}.
          </p>
        )}
      </div>
    </div>
  );
}
