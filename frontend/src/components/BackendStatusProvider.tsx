"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Server } from "lucide-react";
import {
  getBackendStatusSnapshot,
  notifyTabFocus,
  retryWakeUp,
  SERVER_BACKEND_STATUS_SNAPSHOT,
  subscribeBackendStatus,
  warmUpBackend,
  type BackendStatusSnapshot,
} from "@/lib/apiFetch";
import { ServerWakingOverlay } from "./ServerWakingOverlay";

export interface BackendStatusContextValue extends BackendStatusSnapshot {
  retryWakeUp: () => void;
}

const BackendStatusContext = createContext<BackendStatusContextValue | null>(
  null
);

export function BackendStatusProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeBackendStatus,
    getBackendStatusSnapshot,
    () => SERVER_BACKEND_STATUS_SNAPSHOT
  );

  // Silent background warm-up ping once on first load + refocus after >10 min
  useEffect(() => {
    void warmUpBackend();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        notifyTabFocus();
      }
    };

    const handleFocus = () => {
      notifyTabFocus();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const value = useMemo<BackendStatusContextValue>(
    () => ({
      ...snapshot,
      retryWakeUp,
    }),
    [snapshot]
  );

  return (
    <BackendStatusContext.Provider value={value}>
      {children}
      <ServerWakingOverlay snapshot={snapshot} onRetry={retryWakeUp} />
    </BackendStatusContext.Provider>
  );
}

export function useBackendStatus(): BackendStatusContextValue {
  const ctx = useContext(BackendStatusContext);
  if (!ctx) {
    return {
      ...SERVER_BACKEND_STATUS_SNAPSHOT,
      retryWakeUp,
    };
  }
  return ctx;
}

export function WarmupBanner() {
  const { warmingInBackground, overlayVisible, status } = useBackendStatus();

  if (
    !warmingInBackground ||
    overlayVisible ||
    status === "awake" ||
    status === "failed"
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="ui-card-subtle mb-4 flex items-center gap-2 px-3.5 py-2 text-caption font-medium text-ink-secondary"
    >
      <Server className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.75} />
      <span>Starting the server in the background...</span>
    </div>
  );
}

