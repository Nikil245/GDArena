const DEFAULT_API_URL = "http://localhost:8000";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  return trimTrailingSlash(raw || DEFAULT_API_URL);
}

export function getWsBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (explicit) {
    return trimTrailingSlash(explicit);
  }
  const api = getApiBaseUrl();
  if (api.startsWith("https://")) {
    return `wss://${api.slice("https://".length)}`;
  }
  if (api.startsWith("http://")) {
    return `ws://${api.slice("http://".length)}`;
  }
  return "ws://localhost:8000";
}

export function buildRoomWsUrl(code: string, token: string | null): string {
  const base = getWsBaseUrl();
  const normalizedCode = encodeURIComponent(code.trim().toUpperCase());
  const basePath = `${base}/ws/${normalizedCode}`;
  if (token) {
    return `${basePath}?token=${encodeURIComponent(token)}`;
  }
  return basePath;
}

