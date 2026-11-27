import {
  apiFetch,
  BackendUnavailableError,
  RequestInFlightError,
  type ApiFetchOptions,
} from "./apiFetch";
import { getApiBaseUrl } from "./config";
import type {
  CreateRoomRequest,
  FinalReport,
  HealthResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  Room,
  RoomSnapshot,
  ServiceStatusResponse,
  SttResponse,
  TopicsResponse,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(
      path,
      {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      },
      options
    );
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      throw new ApiError(503, "server_unavailable", err.message);
    }
    if (err instanceof RequestInFlightError) {
      throw new ApiError(409, "request_in_flight", err.message);
    }
    throw new ApiError(
      0,
      "network_error",
      "Unable to reach the server. Check that the backend is running."
    );
  }

  let body: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object"
    ) {
      const err = body.error as { code?: string; message?: string };
      throw new ApiError(
        response.status,
        err.code ?? "request_failed",
        err.message ?? `Request failed (${response.status}).`
      );
    }
    if (
      body &&
      typeof body === "object" &&
      "detail" in body &&
      Array.isArray(body.detail) &&
      body.detail.length > 0
    ) {
      const first = body.detail[0] as { msg?: string; loc?: unknown[] };
      const field = Array.isArray(first.loc)
        ? String(first.loc[first.loc.length - 1] ?? "")
        : "";
      const message = field
        ? `${field}: ${first.msg ?? "Invalid value"}`
        : first.msg ?? "Validation error.";
      throw new ApiError(response.status, "validation_error", message);
    }
    throw new ApiError(
      response.status,
      "http_error",
      `Request failed with status ${response.status}.`
    );
  }

  return body as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health", undefined, {
    showOverlay: false,
    retryOnWake: false,
  });
}

export function fetchServiceStatus(): Promise<ServiceStatusResponse> {
  return request<ServiceStatusResponse>("/status", undefined, {
    showOverlay: false,
    retryOnWake: false,
    suppressWaking: true,
  });
}

export function fetchTopics(): Promise<TopicsResponse> {
  return request<TopicsResponse>("/topics", undefined, {
    showOverlay: true,
    retryOnWake: true,
  });
}

export function createRoom(payload: CreateRoomRequest): Promise<Room> {
  return request<Room>(
    "/rooms",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      showOverlay: true,
      retryOnWake: true,
      actionKey: "create_room",
    }
  );
}

export function fetchRoom(code: string): Promise<RoomSnapshot> {
  const clean = encodeURIComponent(code.trim().toUpperCase());
  return request<RoomSnapshot>(`/rooms/${clean}`, undefined, {
    showOverlay: false,
    retryOnWake: true,
  });
}

export function joinRoom(
  code: string,
  payload: JoinRoomRequest
): Promise<JoinRoomResponse> {
  const clean = encodeURIComponent(code.trim().toUpperCase());
  return request<JoinRoomResponse>(
    `/rooms/${clean}/join`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    {
      showOverlay: true,
      retryOnWake: true,
      actionKey: "join_room",
    }
  );
}

export async function fetchReport(
  code: string
): Promise<
  { status: "ready"; report: FinalReport } | { status: "generating" }
> {
  const clean = encodeURIComponent(code.trim().toUpperCase());
  let response: Response;
  try {
    response = await apiFetch(
      `/rooms/${clean}/report`,
      { cache: "no-store" },
      { showOverlay: false, retryOnWake: false }
    );
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      throw new ApiError(503, "server_unavailable", err.message);
    }
    throw new ApiError(0, "network_error", "Unable to reach the server.");
  }

  if (response.status === 202) {
    return { status: "generating" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const err =
      body && typeof body === "object" && "error" in body
        ? (body.error as { code?: string; message?: string })
        : null;
    throw new ApiError(
      response.status,
      err?.code ?? "report_error",
      err?.message ?? "Could not load the report."
    );
  }
  return { status: "ready", report: body as FinalReport };
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalized}`;
}

export interface TestVoiceOptions {
  persona?: string;
  provider?: "groq" | "edge";
  voice?: string;
  text?: string;
}

export async function fetchTestVoice(
  options?: string | TestVoiceOptions
): Promise<Blob> {
  const payload: TestVoiceOptions =
    typeof options === "string" ? { voice: options } : options ?? {};
  let response: Response;
  try {
    response = await apiFetch(
      "/tts/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      },
      {
        showOverlay: true,
        retryOnWake: true,
        actionKey: "test_voice",
      }
    );
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      throw new ApiError(503, "server_unavailable", err.message);
    }
    if (err instanceof RequestInFlightError) {
      throw new ApiError(409, "request_in_flight", err.message);
    }
    throw new ApiError(
      0,
      "network_error",
      "Unable to reach the server for voice testing."
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object"
    ) {
      const err = body.error as { code?: string; message?: string };
      throw new ApiError(
        response.status,
        err.code ?? "tts_error",
        err.message ?? "Voice test failed."
      );
    }
    throw new ApiError(
      response.status,
      "tts_error",
      `Voice test failed (${response.status}).`
    );
  }
  return response.blob();
}

export async function transcribeAudio(
  audioBlob: Blob,
  language = "en"
): Promise<SttResponse> {
  const form = new FormData();
  const ext = audioBlob.type.includes("ogg")
    ? "ogg"
    : audioBlob.type.includes("mp4") || audioBlob.type.includes("m4a")
    ? "m4a"
    : audioBlob.type.includes("wav")
    ? "wav"
    : "webm";
  form.append("file", audioBlob, `turn.${ext}`);
  form.append("language", language);

  let response: Response;
  try {
    response = await apiFetch(
      "/stt",
      {
        method: "POST",
        body: form,
        cache: "no-store",
      },
      {
        showOverlay: true,
        retryOnWake: true,
        actionKey: "transcribe_audio",
        slowRequestMs: 8_000,
      }
    );
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      throw new ApiError(503, "server_unavailable", err.message);
    }
    if (err instanceof RequestInFlightError) {
      throw new ApiError(409, "request_in_flight", err.message);
    }
    throw new ApiError(
      0,
      "network_error",
      "Unable to reach the server for speech transcription."
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      body &&
      typeof body === "object" &&
      "code" in body &&
      typeof (body as { code?: unknown }).code === "string"
    ) {
      const flat = body as {
        code: string;
        message?: string;
        retry_after_seconds?: number | null;
      };
      const retryAfter =
        typeof flat.retry_after_seconds === "number" &&
        Number.isFinite(flat.retry_after_seconds)
          ? flat.retry_after_seconds
          : null;
      throw new ApiError(
        response.status,
        flat.code,
        flat.message ?? "Could not transcribe audio.",
        retryAfter
      );
    }
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object"
    ) {
      const err = body.error as { code?: string; message?: string };
      throw new ApiError(
        response.status,
        err.code ?? "stt_error",
        err.message ?? "Could not transcribe audio."
      );
    }
    throw new ApiError(
      response.status,
      "stt_error",
      `Transcription failed (${response.status}).`
    );
  }
  return body as SttResponse;
}
