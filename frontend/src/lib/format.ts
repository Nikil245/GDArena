import type { EndReason, SkipReason, TopicCategory } from "./types";

export function formatSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return "--:--";
  }
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  const abs = formatScore(Math.abs(delta));
  return delta > 0 ? `+${abs}` : `-${abs}`;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatCategory(category: TopicCategory | null): string {
  switch (category) {
    case "current_affairs":
      return "Current Affairs";
    case "business":
      return "Business & Economy";
    case "social":
      return "Social Issues";
    case "abstract":
      return "Abstract";
    default:
      return "General";
  }
}

export function formatEndReason(reason: EndReason | null): string {
  switch (reason) {
    case "timer":
      return "Session timer completed";
    case "moderator":
      return "Ended by moderator";
    case "server_restart":
      return "Ended due to server restart";
    default:
      return "Session finished";
  }
}

export function formatSkipReason(reason: SkipReason): string {
  switch (reason) {
    case "yielded":
      return "yielded the floor";
    case "time_up":
      return "ran out of turn time";
    case "disconnected":
      return "disconnected";
    case "moderator_skip":
      return "was skipped by moderator";
    case "ai_error":
      return "could not respond in time";
    default:
      return "ended turn early";
  }
}

export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

