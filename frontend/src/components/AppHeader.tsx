"use client";

import Link from "next/link";
import { Users } from "lucide-react";

interface AppHeaderProps {
  rightSlot?: React.ReactNode;
  subHeader?: React.ReactNode;
}

export function AppHeader({ rightSlot, subHeader }: AppHeaderProps) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="app-container flex h-14 items-center justify-between gap-2">
        <Link
          href="/"
          className="ui-focus flex shrink-0 items-center gap-2 rounded-chip text-ink transition-colors duration-150 hover:text-accent sm:gap-2.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip border border-accent bg-accent text-white">
            <Users className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="text-base font-semibold tracking-tight">
            GDArena
          </span>
        </Link>

        <div className="flex min-w-0 shrink-0 items-center gap-3">
          {rightSlot ?? (
            <nav
              aria-label="Primary navigation"
              className="flex items-center gap-2 text-sm font-medium sm:gap-3"
            >
              <Link
                href="/"
                className="ui-focus inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-control px-2.5 text-ink-secondary transition-colors duration-150 hover:text-ink sm:min-h-[36px]"
              >
                Create Room
              </Link>
              <Link
                href="/join"
                className="ui-btn-secondary min-h-[40px] shrink-0 whitespace-nowrap px-3 py-1.5 text-sm sm:min-h-[36px]"
              >
                Join Room
              </Link>
            </nav>
          )}
        </div>
      </div>

      {subHeader}
    </header>
  );
}
