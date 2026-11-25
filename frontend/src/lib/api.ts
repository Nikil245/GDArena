import { getApiBaseUrl } from "./config";
import type {
  CreateRoomRequest,
  FinalReport,
  HealthResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  Room,
  RoomSnapshot,
  SttResponse,
  TopicsResponse,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
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
  return request<HealthResponse>("/health");
}

export function fetchTopics(): Promise<TopicsResponse> {
  return request<TopicsResponse>("/topics");
}

export function createRoom(payload: CreateRoomRequest): Promise<Room> {
  return request<Room>("/rooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchRoom(code: string): Promise<RoomSnapshot> {
  const clean = encodeURIComponent(code.trim().toUpperCase());
  return request<RoomSnapshot>(`/rooms/${clean}`);
}

export function joinRoom(
  code: string,
  payload: JoinRoomRequest
): Promise<JoinRoomResponse> {
  const clean = encodeURIComponent(code.trim().toUpperCase());
  return request<JoinRoomResponse>(`/rooms/${clean}/join`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchReport(
  code: string
): Promise<{ status: "ready"; report: FinalReport } | { status: "generating" }> {
  const clean = encodeURIComponent(code.trim().toUpperCase());
  const url = `${getApiBaseUrl()}/rooms/${clean}/report`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
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
    response = await fetch(`${getApiBaseUrl()}/stt`, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
  } catch {
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

