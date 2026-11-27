import type { ServiceHealthState, WsServiceStatusData } from "./types";

export interface RoomServiceBannerState {
  llmState: ServiceHealthState;
  retryAt: string | null;
  continueWithoutAi: boolean;
  showBackNotice: boolean;
}

export const INITIAL_ROOM_SERVICE_BANNER: RoomServiceBannerState = {
  llmState: "ok",
  retryAt: null,
  continueWithoutAi: false,
  showBackNotice: false,
};

export type RoomServiceBannerAction =
  | {
      type: "service_status";
      payload: WsServiceStatusData;
    }
  | {
      type: "sync_snapshot";
      payload: WsServiceStatusData | undefined;
    }
  | {
      type: "continue_without_ai";
    }
  | {
      type: "dismiss_back_notice";
    };

export function reduceRoomServiceBanner(
  prev: RoomServiceBannerState,
  action: RoomServiceBannerAction
): RoomServiceBannerState {
  switch (action.type) {
    case "sync_snapshot": {
      const payload = action.payload;
      if (!payload || payload.service !== "llm") {
        return prev;
      }
      if (payload.state === "exhausted") {
        return {
          llmState: "exhausted",
          retryAt: payload.retry_at ?? null,
          continueWithoutAi: Boolean(
            payload.continue_without_ai ?? prev.continueWithoutAi
          ),
          showBackNotice: false,
        };
      }
      if (payload.state === "ok") {
        return {
          llmState: "ok",
          retryAt: null,
          continueWithoutAi: false,
          showBackNotice: prev.llmState === "exhausted" || prev.showBackNotice,
        };
      }
      return {
        ...prev,
        llmState: payload.state,
        retryAt: payload.retry_at ?? null,
      };
    }

    case "service_status": {
      const payload = action.payload;
      if (payload.service !== "llm") {
        return prev;
      }
      if (payload.state === "exhausted") {
        return {
          llmState: "exhausted",
          retryAt: payload.retry_at ?? null,
          continueWithoutAi:
            payload.continue_without_ai !== undefined
              ? Boolean(payload.continue_without_ai)
              : prev.continueWithoutAi,
          showBackNotice: false,
        };
      }
      if (payload.state === "ok") {
        return {
          llmState: "ok",
          retryAt: null,
          continueWithoutAi: false,
          showBackNotice: prev.llmState === "exhausted",
        };
      }
      return {
        ...prev,
        llmState: payload.state,
        retryAt: payload.retry_at ?? null,
      };
    }

    case "continue_without_ai": {
      if (prev.llmState !== "exhausted") {
        return prev;
      }
      return {
        ...prev,
        continueWithoutAi: true,
      };
    }

    case "dismiss_back_notice": {
      if (!prev.showBackNotice) {
        return prev;
      }
      return {
        ...prev,
        showBackNotice: false,
      };
    }
  }
}

/**
 * Format an approximate human-readable resume countdown from an ISO timestamp.
 * Returns null if retryAt is absent or invalid.
 */
export function formatEstimatedResume(
  retryAt: string | null | undefined,
  nowMs: number = Date.now()
): string | null {
  if (!retryAt) return null;
  const targetMs = Date.parse(retryAt);
  if (!Number.isFinite(targetMs)) return null;

  const remainingMs = targetMs - nowMs;
  if (remainingMs <= 0) {
    return "Estimated to resume shortly";
  }

  const totalMinutes = Math.max(1, Math.round(remainingMs / 60_000));
  if (totalMinutes < 60) {
    return totalMinutes === 1
      ? "Estimated to resume in about 1 minute"
      : `Estimated to resume in about ${totalMinutes} minutes`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const hourLabel = hours === 1 ? "1 hour" : `${hours} hours`;
  if (mins === 0) {
    return `Estimated to resume in about ${hourLabel}`;
  }
  const minLabel = mins === 1 ? "1 minute" : `${mins} minutes`;
  return `Estimated to resume in about ${hourLabel} ${minLabel}`;
}

export function formatSttRateLimitMessage(
  retryAfterSeconds: number | null | undefined
): string {
  if (
    retryAfterSeconds !== null &&
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
  ) {
    if (retryAfterSeconds >= 60) {
      const mins = Math.ceil(retryAfterSeconds / 60);
      const unit = mins === 1 ? "minute" : "minutes";
      return `Speech recognition is busy right now. Please try again in about ${mins} ${unit}.`;
    }
    const secs = Math.max(1, Math.ceil(retryAfterSeconds));
    const unit = secs === 1 ? "second" : "seconds";
    return `Speech recognition is busy right now. Please try again in about ${secs} ${unit}.`;
  }
  return "Speech recognition is busy right now. Please try again in a moment.";
}

