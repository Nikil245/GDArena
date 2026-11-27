"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Server,
} from "lucide-react";
import type { BackendStatusSnapshot } from "@/lib/apiFetch";

const ESTIMATED_WAKE_SECONDS = 50;
const GITHUB_REPO_URL = "https://github.com/Nikil245/GDArena";

interface ServerWakingOverlayProps {
  snapshot: BackendStatusSnapshot;
  onRetry: () => void;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);
}

export function ServerWakingOverlay({
  snapshot,
  onRetry,
}: ServerWakingOverlayProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const shouldRender =
    snapshot.overlayVisible &&
    (snapshot.status === "waking" ||
      snapshot.status === "slow" ||
      snapshot.status === "failed" ||
      snapshot.overlayClosing);

  // Tick elapsed / remaining every second while waking or slow
  useEffect(() => {
    if (!shouldRender) return;
    if (snapshot.status !== "waking" && snapshot.status !== "slow") return;
    setNowMs(Date.now());
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [shouldRender, snapshot.status]);

  // Trap focus inside dialog and prevent Escape from dismissing
  useEffect(() => {
    if (!shouldRender) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusDialog = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = getFocusableElements(dialog);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialog.focus();
      }
    };

    const rafId = requestAnimationFrame(focusDialog);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusables = getFocusableElements(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(event.target as Node)) {
        focusDialog();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      if (
        previousFocusRef.current &&
        document.contains(previousFocusRef.current)
      ) {
        previousFocusRef.current.focus();
      }
      previousFocusRef.current = null;
    };
  }, [shouldRender]);

  // Move focus onto the primary retry action when transitioning into the failed state
  useEffect(() => {
    if (!shouldRender || snapshot.status !== "failed") return;
    const rafId = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = getFocusableElements(dialog);
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [shouldRender, snapshot.status]);

  if (!shouldRender) return null;

  const isFailed = snapshot.status === "failed";
  const isReady = snapshot.checkPhase === "ready" || snapshot.overlayClosing;
  const elapsedSeconds =
    snapshot.wakingStartedAt !== null
      ? Math.max(0, Math.floor((nowMs - snapshot.wakingStartedAt) / 1000))
      : 0;
  const isSlow =
    snapshot.status === "slow" || elapsedSeconds >= ESTIMATED_WAKE_SECONDS;
  const remainingSeconds = Math.max(1, ESTIMATED_WAKE_SECONDS - elapsedSeconds);
  const progressPct = isReady
    ? 100
    : Math.min(100, Math.round((elapsedSeconds / ESTIMATED_WAKE_SECONDS) * 100));

  const statusLine =
    isReady
      ? "Ready"
      : snapshot.checkPhase === "responded"
      ? "Server responded, getting ready..."
      : "Contacting server...";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 transition-opacity duration-300 motion-reduce:transition-none ${
        snapshot.overlayClosing ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="ui-card w-full max-w-md bg-surface p-6 text-ink focus:outline-none"
      >
        {isFailed ? (
          <>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-danger-border bg-danger-bg text-danger-text">
                <AlertCircle className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-section-title font-semibold text-ink"
                >
                  Server did not start
                </h2>
                <p id={descId} className="mt-1.5 text-sm text-ink-secondary">
                  The server did not start. Please try again in a minute.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onRetry}
                className="ui-btn-primary w-full sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                Try again
              </button>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn-secondary w-full sm:w-auto"
              >
                <span>GitHub repository</span>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-soft text-accent">
                <Server className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-section-title font-semibold text-ink"
                >
                  Waking up the server
                </h2>
                <p
                  id={descId}
                  className="mt-1.5 text-sm leading-relaxed text-ink-secondary"
                >
                  This app runs on a free server that sleeps when nobody is
                  using it. It is starting now, which usually takes under a
                  minute. You do not need to refresh.
                </p>
              </div>
            </div>

            {/* Flat horizontal progress indicator */}
            <div className="mt-5 space-y-2">
              <div
                aria-hidden="true"
                className="h-2 w-full overflow-hidden rounded-chip border border-line bg-muted motion-reduce:hidden"
              >
                {isSlow && !isReady ? (
                  <div className="animate-indeterminate-bar h-full w-1/3 bg-accent" />
                ) : (
                  <div
                    className="h-full bg-accent transition-[width] duration-700 ease-linear motion-reduce:transition-none"
                    style={{ width: `${progressPct}%` }}
                  />
                )}
              </div>

              <div
                aria-live="polite"
                className="flex flex-wrap items-center justify-between gap-2 text-caption"
              >
                <span className="font-medium text-ink">
                  {isReady
                    ? "Server is ready."
                    : isSlow
                    ? "Taking a little longer than usual, still starting..."
                    : `About ${remainingSeconds} ${
                        remainingSeconds === 1 ? "second" : "seconds"
                      } left`}
                </span>
                <span className="text-ink-muted tabular-nums">
                  Elapsed {elapsedSeconds}s
                </span>
              </div>
            </div>

            {/* Honest status line */}
            <div
              aria-live="polite"
              className="mt-4 flex items-center gap-2 border-t border-line-subtle pt-3 text-caption"
            >
              {isReady ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-success-text"
                  strokeWidth={2}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-accent"
                />
              )}
              <span
                className={
                  isReady
                    ? "font-semibold text-success-text"
                    : "font-medium text-ink-muted"
                }
              >
                {statusLine}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
