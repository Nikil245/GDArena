"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBackendStatusSnapshot,
  notifyWsWakeFailure,
  subscribeBackendStatus,
} from "@/lib/apiFetch";
import { buildRoomWsUrl } from "@/lib/config";
import { formatDelta, formatSkipReason } from "@/lib/format";
import {
  INITIAL_ROOM_SERVICE_BANNER,
  reduceRoomServiceBanner,
  type RoomServiceBannerState,
} from "@/lib/serviceStatus";
import type {
  ActivityNotice,
  Participant,
  RoomSnapshot,
  ServerEvent,
  WsErrorData,
  WsScoreAdjustedData,
} from "@/lib/types";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface RoomSocketState {
  status: ConnectionStatus;
  welcomeCount: number;
  you: Participant | null;
  snapshot: RoomSnapshot | null;
  scoreAdjustments: WsScoreAdjustedData[];
  activity: ActivityNotice[];
  serviceStatus: RoomServiceBannerState;
  lastError: WsErrorData | null;
  fatalError: WsErrorData | null;
}

export interface RoomSocketActions {
  sendPing: () => void;
  requestState: () => void;
  startGd: () => void;
  endGd: () => void;
  continueWithoutAi: () => void;
  dismissBackNotice: () => void;
  raiseHand: () => void;
  lowerHand: (participantId?: number) => void;
  submitTurn: (text: string, source?: "text" | "voice") => void;
  yieldTurn: () => void;
  grantTurn: (participantId: number) => void;
  skipSpeaker: () => void;
  adjustScore: (participantId: number, delta: number, reason?: string) => void;
  reportPlaybackEnded: (turnId: number) => void;
  clearError: () => void;
  reconnectNow: () => void;
}

export interface UseRoomSocketResult {
  state: RoomSocketState;
  actions: RoomSocketActions;
}

const FATAL_CLOSE_CODES = new Set([4401, 4404]);
const FATAL_ERROR_CODES = new Set(["room_not_found", "invalid_token"]);
const MAX_BACKOFF_MS = 10_000;
const BASE_BACKOFF_MS = 1_000;

function syncParticipants(
  participants: Participant[],
  queueIds: Set<number>,
  speakerId: number | null
): Participant[] {
  return participants.map((p) => ({
    ...p,
    hand_raised: queueIds.has(p.id),
    is_speaking: speakerId !== null && p.id === speakerId,
  }));
}

function findYou(
  participants: Participant[],
  currentYou: Participant | null
): Participant | null {
  if (!currentYou) return null;
  return participants.find((p) => p.id === currentYou.id) ?? currentYou;
}

export function useRoomSocket(
  code: string,
  token: string | null,
  enabled = true
): UseRoomSocketResult {
  const [state, setState] = useState<RoomSocketState>({
    status: "connecting",
    welcomeCount: 0,
    you: null,
    snapshot: null,
    scoreAdjustments: [],
    activity: [],
    serviceStatus: INITIAL_ROOM_SERVICE_BANNER,
    lastError: null,
    fatalError: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const manualCloseRef = useRef(false);
  const fatalRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const connectFnRef = useRef<(() => void) | null>(null);

  const applyEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "welcome": {
        const snap = event.data.state;
        const queueIds = new Set(snap.queue.map((q) => q.participant_id));
        const speakerId = snap.current_speaker?.participant_id ?? null;
        const synced = syncParticipants(snap.participants, queueIds, speakerId);
        const syncedYou = event.data.you
          ? synced.find((p) => p.id === event.data.you?.id) ?? event.data.you
          : null;

        setState((prev) => ({
          ...prev,
          status: "connected",
          welcomeCount: prev.welcomeCount + 1,
          you: syncedYou,
          snapshot: {
            ...snap,
            participants: synced,
          },
          serviceStatus: reduceRoomServiceBanner(prev.serviceStatus, {
            type: "sync_snapshot",
            payload: snap.service_status,
          }),
          lastError: null,
          fatalError: null,
        }));
        break;
      }

      case "state": {
        const snap = event.data;
        const queueIds = new Set(snap.queue.map((q) => q.participant_id));
        const speakerId = snap.current_speaker?.participant_id ?? null;
        const synced = syncParticipants(snap.participants, queueIds, speakerId);
        setState((prev) => ({
          ...prev,
          you: findYou(synced, prev.you),
          snapshot: { ...snap, participants: synced },
          serviceStatus: reduceRoomServiceBanner(prev.serviceStatus, {
            type: "sync_snapshot",
            payload: snap.service_status,
          }),
        }));
        break;
      }

      case "pong": {
        break;
      }

      case "participants": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const queueIds = new Set(
            prev.snapshot.queue.map((q) => q.participant_id)
          );
          const speakerId =
            prev.snapshot.current_speaker?.participant_id ?? null;
          const synced = syncParticipants(
            event.data.participants,
            queueIds,
            speakerId
          );
          const playersCount = synced.filter((p) => p.role === "player").length;
          const hasMod = synced.some((p) => p.role === "moderator");
          return {
            ...prev,
            you: findYou(synced, prev.you),
            snapshot: {
              ...prev.snapshot,
              room: {
                ...prev.snapshot.room,
                seats_taken: playersCount,
                has_moderator: hasMod,
              },
              participants: synced,
            },
          };
        });
        break;
      }

      case "gd_started": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const queueIds = new Set(
            prev.snapshot.queue.map((q) => q.participant_id)
          );
          const speakerId =
            prev.snapshot.current_speaker?.participant_id ?? null;
          const synced = syncParticipants(
            event.data.participants,
            queueIds,
            speakerId
          );
          const playersCount = synced.filter((p) => p.role === "player").length;
          return {
            ...prev,
            you: findYou(synced, prev.you),
            snapshot: {
              ...prev.snapshot,
              room: {
                ...prev.snapshot.room,
                status: "running",
                topic: event.data.topic,
                started_at: event.data.started_at,
                ends_at: event.data.ends_at,
                duration_seconds: event.data.duration_seconds,
                turn_limit_seconds: event.data.turn_limit_seconds,
                seats_taken: playersCount,
              },
              timer: {
                ...prev.snapshot.timer,
                status: "running",
                duration_seconds: event.data.duration_seconds,
                remaining_seconds: event.data.duration_seconds,
                elapsed_seconds: 0,
                ends_at: event.data.ends_at,
                turn_limit_seconds: event.data.turn_limit_seconds,
              },
              participants: synced,
              ...(event.data.leaderboard
                ? { leaderboard: event.data.leaderboard }
                : {}),
            },
          };
        });
        break;
      }

      case "timer": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              timer: event.data,
            },
          };
        });
        break;
      }

      case "queue": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const queueIds = new Set(
            event.data.queue.map((q) => q.participant_id)
          );
          const speakerId =
            prev.snapshot.current_speaker?.participant_id ?? null;
          const synced = syncParticipants(
            prev.snapshot.participants,
            queueIds,
            speakerId
          );
          return {
            ...prev,
            you: findYou(synced, prev.you),
            snapshot: {
              ...prev.snapshot,
              queue: event.data.queue,
              participants: synced,
            },
          };
        });
        break;
      }

      case "speaker_changed": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const queueIds = new Set(
            prev.snapshot.queue.map((q) => q.participant_id)
          );
          const speakerId = event.data.speaker?.participant_id ?? null;
          const synced = syncParticipants(
            prev.snapshot.participants,
            queueIds,
            speakerId
          );
          return {
            ...prev,
            you: findYou(synced, prev.you),
            snapshot: {
              ...prev.snapshot,
              current_speaker: event.data.speaker,
              participants: synced,
            },
          };
        });
        break;
      }

      case "transcript_entry": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const exists = prev.snapshot.transcript.some(
            (e) => e.turn_id === event.data.turn_id
          );
          const transcript = exists
            ? prev.snapshot.transcript.map((e) =>
                e.turn_id === event.data.turn_id ? event.data : e
              )
            : [...prev.snapshot.transcript, event.data];
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              transcript,
            },
          };
        });
        break;
      }

      case "turn_skipped": {
        if (event.data.reason === "ai_error") {
          break;
        }
        const notice: ActivityNotice = {
          id: `skip-${event.data.seq}-${event.ts}`,
          kind: "turn_skipped",
          message: `${event.data.name} ${formatSkipReason(event.data.reason)}.`,
          ts: event.ts,
        };
        setState((prev) => ({
          ...prev,
          activity: [...prev.activity.slice(-49), notice],
        }));
        break;
      }

      case "turn_scored": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const transcript = prev.snapshot.transcript.map((entry) =>
            entry.turn_id === event.data.turn_id
              ? {
                  ...entry,
                  scores: event.data.scores,
                  comment: event.data.comment,
                  turn_score: event.data.turn_score,
                  score_status:
                    event.data.score_status ??
                    (event.data.turn_score !== null ? "scored" : "not_scored"),
                  score_reason: event.data.score_reason ?? null,
                }
              : entry
          );
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              transcript,
            },
          };
        });
        break;
      }

      case "score_adjusted": {
        const adj = event.data;
        const reasonSuffix = adj.reason ? ` (${adj.reason})` : "";
        const notice: ActivityNotice = {
          id: `adj-${adj.participant_id}-${adj.created_at}`,
          kind: "score_adjusted",
          message: `${adj.by.name} adjusted ${adj.name} by ${formatDelta(adj.delta)}${reasonSuffix}.`,
          ts: adj.created_at,
        };
        setState((prev) => ({
          ...prev,
          scoreAdjustments: [...prev.scoreAdjustments, adj],
          activity: [...prev.activity.slice(-49), notice],
        }));
        break;
      }

      case "leaderboard": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              leaderboard: event.data.leaderboard,
            },
          };
        });
        break;
      }

      case "gd_ended": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          const synced = syncParticipants(
            prev.snapshot.participants,
            new Set(),
            null
          );
          return {
            ...prev,
            you: findYou(synced, prev.you),
            snapshot: {
              ...prev.snapshot,
              room: {
                ...prev.snapshot.room,
                status: "finished",
                ended_at: event.data.ended_at,
                end_reason: event.data.reason,
              },
              current_speaker: null,
              queue: [],
              participants: synced,
              leaderboard: event.data.leaderboard,
              report_status:
                prev.snapshot.report_status === "ready"
                  ? "ready"
                  : "generating",
            },
          };
        });
        break;
      }

      case "report_ready": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              report_status: "ready",
              report: event.data.report,
            },
          };
        });
        break;
      }

      case "report_failed": {
        setState((prev) => {
          if (!prev.snapshot) return prev;
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              report_status: "failed",
            },
            lastError: {
              code: "report_failed",
              message: event.data.message,
            },
          };
        });
        break;
      }

      case "service_status": {
        setState((prev) => ({
          ...prev,
          serviceStatus: reduceRoomServiceBanner(prev.serviceStatus, {
            type: "service_status",
            payload: event.data,
          }),
        }));
        break;
      }

      case "error": {
        const isFatal = FATAL_ERROR_CODES.has(event.data.code);
        if (isFatal) {
          fatalRef.current = true;
        }
        setState((prev) => ({
          ...prev,
          status: isFatal ? "error" : prev.status,
          lastError: event.data,
          fatalError: isFatal ? event.data : prev.fatalError,
        }));
        break;
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !code) return;

    manualCloseRef.current = false;
    fatalRef.current = false;
    retryCountRef.current = 0;
    hasConnectedOnceRef.current = false;
    let waitingForWakeRetry = false;
    let lastAwakeSignal = getBackendStatusSnapshot().awakeSignal;

    const clearTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      clearTimer();
      if (manualCloseRef.current || fatalRef.current) return;

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore
        }
      }

      setState((prev) => ({
        ...prev,
        status: hasConnectedOnceRef.current ? "reconnecting" : "connecting",
      }));

      const url = buildRoomWsUrl(code, token);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCountRef.current = 0;
        hasConnectedOnceRef.current = true;
        waitingForWakeRetry = false;
      };

      ws.onmessage = (msgEvent) => {
        try {
          const parsed = JSON.parse(String(msgEvent.data)) as ServerEvent;
          if (parsed && typeof parsed.type === "string") {
            applyEvent(parsed);
          }
        } catch {
          // Ignore malformed payloads
        }
      };

      ws.onclose = (closeEvent) => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (manualCloseRef.current || fatalRef.current) {
          return;
        }
        if (FATAL_CLOSE_CODES.has(closeEvent.code)) {
          fatalRef.current = true;
          const codeStr =
            closeEvent.code === 4404 ? "room_not_found" : "invalid_token";
          const message =
            closeEvent.code === 4404
              ? "This room does not exist."
              : "Your session token is no longer valid. Please rejoin the room.";
          setState((prev) => ({
            ...prev,
            status: "error",
            fatalError: prev.fatalError ?? { code: codeStr, message },
          }));
          return;
        }

        // Initial connection failed while the backend is waking or not yet confirmed awake:
        // show the waking overlay and retry automatically once /health succeeds.
        if (!hasConnectedOnceRef.current) {
          const backend = getBackendStatusSnapshot();
          if (backend.status !== "awake") {
            waitingForWakeRetry = true;
            void notifyWsWakeFailure()
              .then(() => {
                if (
                  !manualCloseRef.current &&
                  !fatalRef.current &&
                  waitingForWakeRetry
                ) {
                  waitingForWakeRetry = false;
                  retryCountRef.current = 0;
                  connect();
                }
              })
              .catch(() => {
                if (!manualCloseRef.current && !fatalRef.current) {
                  setState((prev) => ({
                    ...prev,
                    status: "reconnecting",
                  }));
                }
              });
            return;
          }
        }

        setState((prev) => ({
          ...prev,
          status: "reconnecting",
        }));

        const delay = Math.min(
          MAX_BACKOFF_MS,
          BASE_BACKOFF_MS * Math.pow(2, retryCountRef.current)
        );
        retryCountRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose handles reconnect transitions
      };
    };

    const unsubscribeBackend = subscribeBackendStatus(() => {
      const next = getBackendStatusSnapshot();
      if (next.awakeSignal > lastAwakeSignal) {
        lastAwakeSignal = next.awakeSignal;
        if (
          waitingForWakeRetry &&
          !manualCloseRef.current &&
          !fatalRef.current &&
          !hasConnectedOnceRef.current &&
          !wsRef.current
        ) {
          waitingForWakeRetry = false;
          retryCountRef.current = 0;
          connect();
        }
      }
    });

    connectFnRef.current = connect;
    connect();

    return () => {
      manualCloseRef.current = true;
      waitingForWakeRetry = false;
      unsubscribeBackend();
      clearTimer();
      connectFnRef.current = null;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore
        }
        wsRef.current = null;
      }
    };
  }, [code, token, enabled, applyEvent]);

  const sendCommand = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setState((prev) => ({
        ...prev,
        lastError: {
          code: "not_connected",
          message: "Not connected to the room. Waiting to reconnect.",
        },
      }));
      return;
    }
    ws.send(JSON.stringify(payload));
  }, []);

  const actions: RoomSocketActions = {
    sendPing: useCallback(
      () => sendCommand({ type: "ping", request_id: String(Date.now()) }),
      [sendCommand]
    ),
    requestState: useCallback(
      () => sendCommand({ type: "get_state" }),
      [sendCommand]
    ),
    startGd: useCallback(() => sendCommand({ type: "start_gd" }), [sendCommand]),
    endGd: useCallback(() => sendCommand({ type: "end_gd" }), [sendCommand]),
    continueWithoutAi: useCallback(() => {
      setState((prev) => ({
        ...prev,
        serviceStatus: reduceRoomServiceBanner(prev.serviceStatus, {
          type: "continue_without_ai",
        }),
      }));
      sendCommand({ type: "continue_without_ai" });
    }, [sendCommand]),
    dismissBackNotice: useCallback(() => {
      setState((prev) => ({
        ...prev,
        serviceStatus: reduceRoomServiceBanner(prev.serviceStatus, {
          type: "dismiss_back_notice",
        }),
      }));
    }, []),
    raiseHand: useCallback(
      () => sendCommand({ type: "raise_hand" }),
      [sendCommand]
    ),
    lowerHand: useCallback(
      (participantId?: number) =>
        sendCommand(
          participantId !== undefined
            ? { type: "lower_hand", participant_id: participantId }
            : { type: "lower_hand" }
        ),
      [sendCommand]
    ),
    submitTurn: useCallback(
      (text: string, source: "text" | "voice" = "text") =>
        sendCommand({ type: "submit_turn", text, source }),
      [sendCommand]
    ),
    yieldTurn: useCallback(
      () => sendCommand({ type: "yield_turn" }),
      [sendCommand]
    ),
    grantTurn: useCallback(
      (participantId: number) =>
        sendCommand({ type: "grant_turn", participant_id: participantId }),
      [sendCommand]
    ),
    skipSpeaker: useCallback(
      () => sendCommand({ type: "skip_speaker" }),
      [sendCommand]
    ),
    adjustScore: useCallback(
      (participantId: number, delta: number, reason?: string) =>
        sendCommand({
          type: "adjust_score",
          participant_id: participantId,
          delta,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        }),
      [sendCommand]
    ),
    reportPlaybackEnded: useCallback((turnId: number) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "playback_ended", turn_id: turnId }));
      }
    }, []),
    clearError: useCallback(() => {
      setState((prev) => ({ ...prev, lastError: null }));
    }, []),
    reconnectNow: useCallback(() => {
      if (fatalRef.current) return;
      retryCountRef.current = 0;
      connectFnRef.current?.();
    }, []),
  };

  return { state, actions };
}

