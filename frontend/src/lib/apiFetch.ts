import { getApiBaseUrl } from "./config";

export type BackendHealthStatus =
  | "unknown"
  | "awake"
  | "waking"
  | "slow"
  | "failed";

export type HealthCheckPhase = "idle" | "contacting" | "responded" | "ready";

export interface BackendStatusSnapshot {
  status: BackendHealthStatus;
  overlayVisible: boolean;
  overlayClosing: boolean;
  warmingInBackground: boolean;
  checkPhase: HealthCheckPhase;
  wakingStartedAt: number | null;
  lastAwakeAt: number | null;
  awakeSignal: number;
}

export interface ApiFetchOptions {
  /** Whether a slow or waking request should open the blocking modal overlay (default: true). */
  showOverlay?: boolean;
  /** Whether a network/502/503/504 failure may be retried once after /health succeeds. Defaults to true for GET/HEAD, false otherwise. */
  retryOnWake?: boolean;
  /** Optional per-action key guarding against duplicate concurrent requests (e.g. POST /rooms). */
  actionKey?: string;
  /** Optional override for how long a pending request waits before entering waking state. */
  slowRequestMs?: number;
  /** When true, this background probe will never transition backend status to waking or open the overlay. */
  suppressWaking?: boolean;
}

export class RequestInFlightError extends Error {
  constructor(actionKey: string) {
    super(`Action "${actionKey}" is already in progress.`);
    this.name = "RequestInFlightError";
  }
}

export class BackendUnavailableError extends Error {
  constructor(
    message = "The server did not start. Please try again in a minute."
  ) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

export interface BackendMonitorConfig {
  fetchImpl?: typeof fetch;
  getBaseUrl?: () => string;
  now?: () => number;
  slowRequestMs?: number;
  bannerDelayMs?: number;
  wakingGraceMs?: number;
  pollIntervalMs?: number;
  healthTimeoutMs?: number;
  estimatedWakeMs?: number;
  maxWakeMs?: number;
  readyFadeMs?: number;
  refocusWarmupMs?: number;
  simulateColdStart?: boolean;
}

const WAKING_HTTP_STATUSES = new Set([502, 503, 504]);

const DEFAULT_CONFIG = {
  slowRequestMs: 3_000,
  bannerDelayMs: 600,
  wakingGraceMs: 300,
  pollIntervalMs: 3_000,
  healthTimeoutMs: 8_000,
  estimatedWakeMs: 50_000,
  maxWakeMs: 120_000,
  readyFadeMs: 650,
  refocusWarmupMs: 10 * 60 * 1000,
} as const;

export const SERVER_BACKEND_STATUS_SNAPSHOT: BackendStatusSnapshot =
  Object.freeze({
    status: "unknown",
    overlayVisible: false,
    overlayClosing: false,
    warmingInBackground: false,
    checkPhase: "idle",
    wakingStartedAt: null,
    lastAwakeAt: null,
    awakeSignal: 0,
  });

function isDevColdStartSimulationEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_SIMULATE_COLD_START === "1"
  );
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    ("name" in err && (err as { name: unknown }).name === "AbortError")
  );
}

function waitWithSignal(
  ms: number,
  signal?: AbortSignal | null
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface BackendMonitor {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => BackendStatusSnapshot;
  apiFetch: (
    pathOrUrl: string,
    init?: RequestInit,
    options?: ApiFetchOptions
  ) => Promise<Response>;
  warmUpBackend: (opts?: { force?: boolean }) => Promise<void>;
  onTabFocus: () => void;
  retryWakeUp: () => void;
  notifyWsWakeFailure: () => Promise<void>;
  dispose: () => void;
}

export function createBackendMonitor(
  config: BackendMonitorConfig = {}
): BackendMonitor {
  const fetchFn: typeof fetch =
    config.fetchImpl ?? ((input, init) => fetch(input, init));
  const getBaseUrl = config.getBaseUrl ?? getApiBaseUrl;
  const now = config.now ?? (() => Date.now());

  const slowRequestMs = config.slowRequestMs ?? DEFAULT_CONFIG.slowRequestMs;
  const bannerDelayMs = config.bannerDelayMs ?? DEFAULT_CONFIG.bannerDelayMs;
  const wakingGraceMs = config.wakingGraceMs ?? DEFAULT_CONFIG.wakingGraceMs;
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs;
  const healthTimeoutMs =
    config.healthTimeoutMs ?? DEFAULT_CONFIG.healthTimeoutMs;
  const estimatedWakeMs =
    config.estimatedWakeMs ?? DEFAULT_CONFIG.estimatedWakeMs;
  const maxWakeMs = config.maxWakeMs ?? DEFAULT_CONFIG.maxWakeMs;
  const readyFadeMs = config.readyFadeMs ?? DEFAULT_CONFIG.readyFadeMs;
  const refocusWarmupMs =
    config.refocusWarmupMs ?? DEFAULT_CONFIG.refocusWarmupMs;

  const listeners = new Set<() => void>();
  const inFlightActions = new Set<string>();
  const awakeWaiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  let snapshot: BackendStatusSnapshot = { ...SERVER_BACKEND_STATUS_SNAPSHOT };
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let failTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInFlight = false;
  let pollingActive = false;
  let warmUpInFlight = false;
  let activeHealthAbort: AbortController | null = null;

  // Development-only cold-start simulator state (stripped in production builds)
  const simEnabled =
    process.env.NODE_ENV !== "production" &&
    (config.simulateColdStart !== undefined
      ? config.simulateColdStart
      : isDevColdStartSimulationEnabled());
  let simStartMs: number | null = null;
  let simReadyAtMs: number | null = null;
  let simFirstApiDelayed = false;
  let simFinished = false;
  let simLogged = false;

  const emit = (patch: Partial<BackendStatusSnapshot>) => {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof BackendStatusSnapshot>) {
      if (snapshot[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = Object.freeze({ ...snapshot, ...patch });
    listeners.forEach((listener) => listener());
  };

  const resolveUrl = (pathOrUrl: string): string => {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    const normalized = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${getBaseUrl()}${normalized}`;
  };

  const clearTimers = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (slowTimer !== null) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
    if (failTimer !== null) {
      clearTimeout(failTimer);
      failTimer = null;
    }
    if (activeHealthAbort) {
      activeHealthAbort.abort();
      activeHealthAbort = null;
    }
    pollingActive = false;
    pollInFlight = false;
  };

  const clearFadeTimer = () => {
    if (fadeTimer !== null) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
  };

  const settleWaitersSuccess = () => {
    const waiters = awakeWaiters.splice(0, awakeWaiters.length);
    waiters.forEach((w) => w.resolve());
  };

  const settleWaitersFailure = (err: Error) => {
    const waiters = awakeWaiters.splice(0, awakeWaiters.length);
    waiters.forEach((w) => w.reject(err));
  };

  const runSimulatedOrRealFetch = async (
    url: string,
    init: RequestInit | undefined,
    isHealthCheck: boolean
  ): Promise<Response> => {
    if (process.env.NODE_ENV === "production" || !simEnabled || simFinished) {
      return fetchFn(url, init);
    }

    const current = now();
    if (simStartMs === null || simReadyAtMs === null) {
      simStartMs = current;
      simReadyAtMs = current + 20_000;
      if (!simLogged) {
        simLogged = true;
        console.info(
          "[GDArena Dev] Simulating Render cold start (20s) via NEXT_PUBLIC_SIMULATE_COLD_START=1"
        );
      }
    }

    if (current >= simReadyAtMs) {
      simFinished = true;
      return fetchFn(url, init);
    }

    if (isHealthCheck) {
      const elapsed = current - simStartMs;
      const remaining = simReadyAtMs - current;
      if (elapsed < 4_000) {
        await waitWithSignal(Math.min(1_200, remaining), init?.signal);
        if (now() < simReadyAtMs) {
          throw new TypeError("Failed to fetch (Simulated Cold Start)");
        }
        simFinished = true;
        return fetchFn(url, init);
      }
      await waitWithSignal(Math.min(500, remaining), init?.signal);
      if (now() >= simReadyAtMs) {
        simFinished = true;
        return fetchFn(url, init);
      }
      return new Response(null, {
        status: 503,
        statusText: "Service Unavailable (Simulated Cold Start)",
      });
    }

    if (!simFirstApiDelayed) {
      simFirstApiDelayed = true;
      const elapsed = current - simStartMs;
      if (elapsed < 6_000) {
        // Delay past 3s threshold and return 503 so both waking overlay and retry-after-health run
        await waitWithSignal(
          Math.min(3_400, simReadyAtMs - current),
          init?.signal
        );
        if (now() < simReadyAtMs) {
          return new Response(null, {
            status: 503,
            statusText: "Service Unavailable (Simulated Cold Start)",
          });
        }
      } else {
        // Hold original request until simulated boot finishes
        await waitWithSignal(simReadyAtMs - current, init?.signal);
      }
      simFinished = true;
    }

    return fetchFn(url, init);
  };

  const markAwake = () => {
    clearTimers();
    const wasOverlayVisible = snapshot.overlayVisible;
    const nextSignal = snapshot.awakeSignal + 1;

    if (wasOverlayVisible && snapshot.overlayClosing) {
      emit({
        status: "awake",
        warmingInBackground: false,
        lastAwakeAt: now(),
        awakeSignal: nextSignal,
      });
      settleWaitersSuccess();
      return;
    }

    clearFadeTimer();

    if (wasOverlayVisible) {
      emit({
        status: "awake",
        warmingInBackground: false,
        checkPhase: "ready",
        overlayVisible: true,
        overlayClosing: true,
        lastAwakeAt: now(),
        awakeSignal: nextSignal,
      });
      settleWaitersSuccess();

      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        emit({
          overlayVisible: false,
          overlayClosing: false,
          checkPhase: "idle",
          wakingStartedAt: null,
        });
      }, readyFadeMs);
    } else {
      emit({
        status: "awake",
        warmingInBackground: false,
        overlayVisible: false,
        overlayClosing: false,
        checkPhase: "idle",
        wakingStartedAt: null,
        lastAwakeAt: now(),
        awakeSignal: nextSignal,
      });
      settleWaitersSuccess();
    }
  };

  const markFailed = () => {
    clearTimers();
    clearFadeTimer();
    emit({
      status: "failed",
      warmingInBackground: false,
      overlayClosing: false,
    });
    settleWaitersFailure(new BackendUnavailableError());
  };

  const scheduleWatchdogs = (startedAt: number) => {
    if (slowTimer !== null) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
    if (failTimer !== null) {
      clearTimeout(failTimer);
      failTimer = null;
    }

    const elapsed = now() - startedAt;
    const msToSlow = Math.max(0, estimatedWakeMs - elapsed);
    const msToFail = Math.max(0, maxWakeMs - elapsed);

    if (msToFail === 0) {
      markFailed();
      return;
    }

    if (msToSlow === 0) {
      if (snapshot.status === "waking") {
        emit({ status: "slow" });
      }
    } else {
      slowTimer = setTimeout(() => {
        slowTimer = null;
        if (snapshot.status === "waking") {
          emit({ status: "slow" });
        }
      }, msToSlow);
    }

    failTimer = setTimeout(() => {
      failTimer = null;
      if (snapshot.status === "waking" || snapshot.status === "slow") {
        markFailed();
      }
    }, msToFail);
  };

  const runHealthPollOnce = async () => {
    if (!pollingActive || pollInFlight) return;
    if (
      snapshot.wakingStartedAt !== null &&
      now() - snapshot.wakingStartedAt >= maxWakeMs
    ) {
      markFailed();
      return;
    }

    pollInFlight = true;
    const controller = new AbortController();
    activeHealthAbort = controller;
    const timeoutId = setTimeout(() => controller.abort(), healthTimeoutMs);

    try {
      const url = resolveUrl("/health");
      const res = await runSimulatedOrRealFetch(
        url,
        { method: "GET", cache: "no-store", signal: controller.signal },
        true
      );
      clearTimeout(timeoutId);
      if (activeHealthAbort === controller) {
        activeHealthAbort = null;
      }

      if (!pollingActive) return;

      if (res.ok) {
        markAwake();
        return;
      }

      // Server (or proxy) returned an HTTP response (e.g. 502/503/504)
      if (snapshot.checkPhase === "contacting" || snapshot.checkPhase === "idle") {
        emit({ checkPhase: "responded" });
      }
    } catch {
      clearTimeout(timeoutId);
      if (activeHealthAbort === controller) {
        activeHealthAbort = null;
      }
      if (!pollingActive) return;
    } finally {
      pollInFlight = false;
    }

    if (!pollingActive) return;

    if (
      snapshot.wakingStartedAt !== null &&
      now() - snapshot.wakingStartedAt >= maxWakeMs
    ) {
      markFailed();
      return;
    }

    pollTimer = setTimeout(() => {
      pollTimer = null;
      void runHealthPollOnce();
    }, pollIntervalMs);
  };

  const startWaking = (showOverlay: boolean, resetTimer = false) => {
    clearFadeTimer();
    const isAlreadyWaking =
      !resetTimer &&
      (snapshot.status === "waking" || snapshot.status === "slow") &&
      snapshot.wakingStartedAt !== null;

    const startedAt = isAlreadyWaking
      ? (snapshot.wakingStartedAt as number)
      : now();
    const elapsed = now() - startedAt;
    const nextStatus: BackendHealthStatus =
      elapsed >= estimatedWakeMs ? "slow" : "waking";
    const nextPhase: HealthCheckPhase =
      !resetTimer && snapshot.checkPhase === "responded"
        ? "responded"
        : "contacting";

    emit({
      status: nextStatus,
      overlayVisible: showOverlay || snapshot.overlayVisible,
      overlayClosing: false,
      checkPhase: nextPhase,
      wakingStartedAt: startedAt,
    });

    if (!pollingActive) {
      pollingActive = true;
      scheduleWatchdogs(startedAt);
      void runHealthPollOnce();
    } else if (resetTimer) {
      scheduleWatchdogs(startedAt);
    }
  };

  const waitForAwake = (): Promise<void> => {
    if (snapshot.status === "awake") {
      return Promise.resolve();
    }
    if (snapshot.status === "failed") {
      return Promise.reject(new BackendUnavailableError());
    }
    return new Promise<void>((resolve, reject) => {
      awakeWaiters.push({ resolve, reject });
    });
  };

  const warmUpBackend = async (opts?: { force?: boolean }): Promise<void> => {
    if (warmUpInFlight || pollingActive) return;
    if (
      !opts?.force &&
      snapshot.status === "awake" &&
      snapshot.lastAwakeAt !== null &&
      now() - snapshot.lastAwakeAt < refocusWarmupMs
    ) {
      return;
    }

    warmUpInFlight = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), healthTimeoutMs);
    const bannerTimerId = setTimeout(() => {
      if (warmUpInFlight && snapshot.status !== "awake") {
        emit({ warmingInBackground: true });
      }
    }, bannerDelayMs);
    const slowWarmupId = setTimeout(() => {
      if (warmUpInFlight && snapshot.status !== "awake") {
        emit({ warmingInBackground: true });
        startWaking(false);
      }
    }, slowRequestMs);

    try {
      const res = await runSimulatedOrRealFetch(
        resolveUrl("/health"),
        { method: "GET", cache: "no-store", signal: controller.signal },
        true
      );
      clearTimeout(timeoutId);
      clearTimeout(bannerTimerId);
      clearTimeout(slowWarmupId);

      if (res.ok) {
        markAwake();
      } else {
        emit({ warmingInBackground: true });
        startWaking(false);
        if (snapshot.checkPhase === "contacting") {
          emit({ checkPhase: "responded" });
        }
      }
    } catch {
      clearTimeout(timeoutId);
      clearTimeout(bannerTimerId);
      clearTimeout(slowWarmupId);
      emit({ warmingInBackground: true });
      startWaking(false);
    } finally {
      warmUpInFlight = false;
    }
  };

  const onTabFocus = () => {
    if (
      snapshot.lastAwakeAt === null ||
      now() - snapshot.lastAwakeAt > refocusWarmupMs
    ) {
      void warmUpBackend();
    }
  };

  const retryWakeUp = () => {
    clearTimers();
    startWaking(true, true);
  };

  const notifyWsWakeFailure = (): Promise<void> => {
    startWaking(true);
    return waitForAwake();
  };

  const apiFetch = async (
    pathOrUrl: string,
    init?: RequestInit,
    options: ApiFetchOptions = {}
  ): Promise<Response> => {
    const showOverlay = options.suppressWaking ? false : (options.showOverlay ?? true);
    const suppressWaking = Boolean(options.suppressWaking);
    const method = (init?.method ?? "GET").toUpperCase();
    const retryOnWake = suppressWaking
      ? false
      : (options.retryOnWake ?? (method === "GET" || method === "HEAD"));
    const actionKey = options.actionKey;

    if (actionKey) {
      if (inFlightActions.has(actionKey)) {
        throw new RequestInFlightError(actionKey);
      }
      inFlightActions.add(actionKey);
    }

    const url = resolveUrl(pathOrUrl);
    const isHealthEndpoint = /\/health(?:\?|$)/.test(url);
    const requestInit: RequestInit = {
      ...init,
      cache: init?.cache ?? "no-store",
    };

    const reqSlowMs = options.slowRequestMs ?? slowRequestMs;

    try {
      const attemptOnce = async (isRetry: boolean): Promise<Response> => {
        const delayBeforeWaking =
          showOverlay &&
          (snapshot.status === "waking" || snapshot.status === "slow")
            ? wakingGraceMs
            : reqSlowMs;

        let slowTimerId: ReturnType<typeof setTimeout> | null = null;
        if (!isRetry && !suppressWaking) {
          slowTimerId = setTimeout(() => {
            slowTimerId = null;
            startWaking(showOverlay);
          }, delayBeforeWaking);
        }

        let response: Response | null = null;
        let fetchError: unknown = null;

        try {
          response = await runSimulatedOrRealFetch(
            url,
            requestInit,
            isHealthEndpoint
          );
        } catch (err) {
          fetchError = err;
        } finally {
          if (slowTimerId !== null) {
            clearTimeout(slowTimerId);
            slowTimerId = null;
          }
        }

        // Caller explicitly aborted the request -> propagate directly
        if (fetchError !== null && isAbortError(fetchError) && init?.signal?.aborted) {
          throw fetchError;
        }

        const isWakingStatus =
          response !== null && WAKING_HTTP_STATUSES.has(response.status);

        // Running server responded (2xx, 400, 401, 404, 409, 422, 500, etc.)
        if (response !== null && !isWakingStatus) {
          markAwake();
          return response;
        }

        // Network/CORS-like failure or 502/503/504 -> waking state (unless suppressed)
        if (!suppressWaking) {
          startWaking(showOverlay, snapshot.status === "failed");
          if (
            isHealthEndpoint &&
            response !== null &&
            snapshot.checkPhase === "contacting"
          ) {
            emit({ checkPhase: "responded" });
          }
        }

        if (retryOnWake && !isRetry) {
          await waitForAwake();
          return attemptOnce(true);
        }

        if (response !== null) {
          return response;
        }
        throw fetchError;
      };

      return await attemptOnce(false);
    } finally {
      if (actionKey) {
        inFlightActions.delete(actionKey);
      }
    }
  };

  const dispose = () => {
    clearTimers();
    clearFadeTimer();
    settleWaitersFailure(new BackendUnavailableError("Monitor disposed."));
    listeners.clear();
    inFlightActions.clear();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    apiFetch,
    warmUpBackend,
    onTabFocus,
    retryWakeUp,
    notifyWsWakeFailure,
    dispose,
  };
}

const defaultMonitor = createBackendMonitor();

export const subscribeBackendStatus = defaultMonitor.subscribe;
export const getBackendStatusSnapshot = defaultMonitor.getSnapshot;
export const apiFetch = defaultMonitor.apiFetch;
export const warmUpBackend = defaultMonitor.warmUpBackend;
export const notifyTabFocus = defaultMonitor.onTabFocus;
export const retryWakeUp = defaultMonitor.retryWakeUp;
export const notifyWsWakeFailure = defaultMonitor.notifyWsWakeFailure;
