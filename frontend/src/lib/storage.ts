import type { StoredSession } from "./types";

export type TableViewMode = "3d" | "2d";

const SESSION_PREFIX = "gdarena:session:";
const PROFILE_KEY = "gdarena:player_profile";
const TABLE_VIEW_KEY = "gdarena:table_view_mode";

function keyForRoom(code: string): string {
  return `${SESSION_PREFIX}${code.trim().toUpperCase()}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.roomCode === "string" &&
      typeof parsed.participantId === "number" &&
      typeof parsed.name === "string" &&
      (parsed.role === "player" || parsed.role === "moderator") &&
      typeof parsed.token === "string"
    ) {
      return parsed as StoredSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists the participant session in both sessionStorage (tab-isolated so
 * testing with a Moderator tab + Player tab in the same browser never clobbers
 * either tab on refresh) and localStorage (survives reopening the browser and
 * remembers the player's id and name across refreshes).
 */
export function saveRoomSession(session: StoredSession): void {
  if (!isBrowser()) return;
  const normalized: StoredSession = {
    ...session,
    roomCode: session.roomCode.trim().toUpperCase(),
  };
  const serialized = JSON.stringify(normalized);
  const key = keyForRoom(normalized.roomCode);

  try {
    window.sessionStorage.setItem(key, serialized);
  } catch {
    // Ignore storage quota / privacy mode errors
  }

  try {
    window.localStorage.setItem(key, serialized);
    window.localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        participantId: normalized.participantId,
        name: normalized.name,
      })
    );
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function loadRoomSession(code: string): StoredSession | null {
  if (!isBrowser()) return null;
  const key = keyForRoom(code);
  try {
    const fromTab = parseSession(window.sessionStorage.getItem(key));
    if (fromTab) return fromTab;
  } catch {
    // Fallback to localStorage
  }
  try {
    const fromLocal = parseSession(window.localStorage.getItem(key));
    if (fromLocal) {
      // Pin to this tab's sessionStorage so subsequent refreshes remain bound
      try {
        window.sessionStorage.setItem(key, JSON.stringify(fromLocal));
      } catch {
        // Ignore
      }
      return fromLocal;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function clearRoomSession(code: string): void {
  if (!isBrowser()) return;
  const key = keyForRoom(code);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

export function loadSavedName(): string {
  if (!isBrowser()) return "";
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return "";
  }
}

export function loadTableViewMode(): TableViewMode {
  if (!isBrowser()) return "3d";
  try {
    const raw = window.localStorage.getItem(TABLE_VIEW_KEY);
    return raw === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

export function saveTableViewMode(mode: TableViewMode): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(TABLE_VIEW_KEY, mode);
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

