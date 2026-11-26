"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  LogOut,
  MoreVertical,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { ConnectionStatus } from "@/hooks/useRoomSocket";
import type { Participant } from "@/lib/types";

interface RoomHeaderControlsProps {
  roomCode: string;
  you: Participant | null;
  connectionStatus: ConnectionStatus;
  muted: boolean;
  testingVoice: boolean;
  onToggleMute: () => void;
  onTestVoice: () => void;
}

function getStatusMeta(status: ConnectionStatus): {
  label: string;
  isConnected: boolean;
  desktopClasses: string;
  stripTextClass: string;
} {
  switch (status) {
    case "connected":
      return {
        label: "Connected",
        isConnected: true,
        desktopClasses: "border-success-border bg-success-bg text-success-text",
        stripTextClass: "text-success-text",
      };
    case "reconnecting":
      return {
        label: "Reconnecting...",
        isConnected: false,
        desktopClasses: "border-line-input bg-subtle text-ink-secondary",
        stripTextClass: "text-ink-secondary",
      };
    case "error":
      return {
        label: "Disconnected",
        isConnected: false,
        desktopClasses: "border-danger-border bg-danger-bg text-danger-text",
        stripTextClass: "text-danger-text",
      };
    default:
      return {
        label: "Connecting...",
        isConnected: false,
        desktopClasses: "border-line bg-subtle text-ink-muted",
        stripTextClass: "text-ink-muted",
      };
  }
}

function getRoleLabel(you: Participant): string {
  if (you.role === "moderator") return "Moderator";
  if (you.can_moderate) return "Player (Host)";
  return "Player";
}

export function RoomMobileStatusStrip({
  connectionStatus,
}: {
  connectionStatus: ConnectionStatus;
}) {
  const status = getStatusMeta(connectionStatus);

  return (
    <div className="border-t border-line-subtle bg-subtle md:hidden">
      <div
        role="status"
        aria-live="polite"
        className="app-container flex h-7 items-center"
      >
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium leading-none ${status.stripTextClass}`}
        >
          {status.isConnected ? (
            <Wifi className="h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <WifiOff className="h-3 w-3 shrink-0" strokeWidth={2} />
          )}
          <span>{status.label}</span>
        </span>
      </div>
    </div>
  );
}

export function RoomHeaderControls({
  roomCode,
  you,
  connectionStatus,
  muted,
  testingVoice,
  onToggleMute,
  onTestVoice,
}: RoomHeaderControlsProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuId = useId();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const getMenuItems = (): HTMLElement[] => {
      if (!menuRef.current) return [];
      return Array.from(
        menuRef.current.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled])'
        )
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (!menuRef.current?.contains(document.activeElement)) return;

      const items = getMenuItems();
      if (items.length === 0) return;

      const currentIndex = items.indexOf(
        document.activeElement as HTMLElement
      );

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex =
          currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
        items[nextIndex]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex =
          currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        items[prevIndex]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopiedCode(false);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleTestVoiceFromMenu = () => {
    setMenuOpen(false);
    onTestVoice();
  };

  const handleMenuButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === "ArrowDown" && !menuOpen) {
      event.preventDefault();
      setMenuOpen(true);
      requestAnimationFrame(() => {
        const firstItem = menuRef.current?.querySelector<HTMLElement>(
          '[role="menuitem"]:not([disabled])'
        );
        firstItem?.focus();
      });
    }
  };

  const status = getStatusMeta(connectionStatus);
  const roleLabel = you ? getRoleLabel(you) : null;

  return (
    <>
      {/* Desktop / tablet layout (md and above) */}
      <div className="hidden items-center gap-2 md:flex lg:gap-2.5">
        <button
          type="button"
          onClick={copyCode}
          title="Copy room code"
          aria-label={
            copiedCode
              ? `Room code ${roomCode} copied`
              : `Copy room code ${roomCode}`
          }
          className="ui-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-chip border border-line bg-subtle px-2.5 text-xs font-semibold tracking-wider text-ink transition-colors duration-150 hover:border-line-strong"
        >
          {copiedCode ? (
            <Check className="h-3.5 w-3.5 text-success-text" strokeWidth={2} />
          ) : (
            <Copy className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
          )}
          {roomCode}
        </button>

        {you && roleLabel && (
          <span className="inline-flex h-9 max-w-[150px] shrink-0 items-center truncate rounded-chip border border-line bg-surface px-2.5 text-xs font-medium text-ink-secondary lg:max-w-none">
            {you.name} · {roleLabel}
          </span>
        )}

        <span
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-chip border px-2.5 text-xs font-medium ${status.desktopClasses}`}
        >
          {status.isConnected ? (
            <Wifi className="h-3 w-3" strokeWidth={2} />
          ) : (
            <WifiOff className="h-3 w-3" strokeWidth={2} />
          )}
          {status.label}
        </span>

        <button
          type="button"
          onClick={onToggleMute}
          title={muted ? "Unmute AI voices" : "Mute AI voices"}
          aria-pressed={muted}
          className={`ui-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-chip border px-2.5 text-xs font-medium transition-colors duration-150 ${
            muted
              ? "border-line-input bg-muted text-ink-muted hover:bg-subtle"
              : "border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
          }`}
        >
          {muted ? (
            <VolumeX className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
          ) : (
            <Volume2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
          )}
          <span className="hidden lg:inline">
            {muted ? "AI Muted" : "AI Voice"}
          </span>
        </button>

        <button
          type="button"
          onClick={onTestVoice}
          disabled={testingVoice}
          title="Test server-side AI voice playback"
          className="ui-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-chip border border-line-input bg-surface px-2.5 text-xs font-medium text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testingVoice ? "Testing..." : "Test voice"}
        </button>

        <Link
          href="/"
          title="Leave room"
          className="ui-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-chip border border-line-input bg-surface px-2.5 text-xs font-medium text-ink-secondary transition-colors duration-150 hover:border-danger-border hover:bg-danger-bg hover:text-danger-text"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden lg:inline">Leave</span>
        </Link>
      </div>

      {/* Mobile layout (below md): single aligned row, 40px targets, 8px gaps */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={copyCode}
          aria-label={
            copiedCode
              ? `Room code ${roomCode} copied`
              : `Copy room code ${roomCode}`
          }
          title="Copy room code"
          className="ui-focus inline-flex h-10 min-w-[40px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-chip border border-line bg-subtle px-2 text-[11px] font-semibold tracking-wider text-ink transition-colors duration-150 hover:border-line-strong"
        >
          {copiedCode ? (
            <Check
              className="h-3.5 w-3.5 shrink-0 text-success-text"
              strokeWidth={2}
            />
          ) : (
            <Copy
              className="h-3.5 w-3.5 shrink-0 text-ink-muted"
              strokeWidth={1.75}
            />
          )}
          <span>{roomCode}</span>
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Unmute AI voices" : "Mute AI voices"}
          aria-pressed={muted}
          title={muted ? "Unmute AI voices" : "Mute AI voices"}
          className={`ui-focus inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-chip border transition-colors duration-150 ${
            muted
              ? "border-line-input bg-muted text-ink-muted hover:bg-subtle"
              : "border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
          }`}
        >
          {muted ? (
            <VolumeX className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
          ) : (
            <Volume2 className="h-4 w-4 text-accent" strokeWidth={1.75} />
          )}
        </button>

        <div ref={menuContainerRef} className="relative shrink-0">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            onKeyDown={handleMenuButtonKeyDown}
            aria-label="More room options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            title="More options"
            className={`ui-focus inline-flex h-10 w-10 items-center justify-center rounded-chip border transition-colors duration-150 ${
              menuOpen
                ? "border-line-strong bg-muted text-ink"
                : "border-line-input bg-surface text-ink-secondary hover:border-line-strong hover:bg-subtle"
            }`}
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="Room options"
              className="absolute right-0 top-full z-40 mt-1.5 w-60 rounded-control border border-line bg-surface py-1 shadow-popover"
            >
              <div className="border-b border-line-subtle px-3 py-2.5">
                {you && roleLabel ? (
                  <>
                    <p className="truncate text-xs font-semibold text-ink">
                      {you.name}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-ink-muted">
                      {roleLabel}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-ink">Spectator</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      Read-only view
                    </p>
                  </>
                )}
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={handleTestVoiceFromMenu}
                disabled={testingVoice}
                className="flex min-h-[40px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink-secondary transition-colors duration-150 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Volume2
                  className="h-4 w-4 shrink-0 text-ink-muted"
                  strokeWidth={1.75}
                />
                <span>{testingVoice ? "Testing voice..." : "Test voice"}</span>
              </button>

              <div className="mt-1 border-t border-line pt-1">
                <Link
                  href="/"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-[40px] w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold text-danger-text transition-colors duration-150 hover:bg-danger-bg focus-visible:bg-danger-bg focus-visible:outline-none"
                >
                  <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>Leave room</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
