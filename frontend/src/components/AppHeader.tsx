"use client";

import Link from "next/link";
import { Users } from "lucide-react";

interface AppHeaderProps {
  rightSlot?: React.ReactNode;
}

export function AppHeader({ rightSlot }: AppHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-slate-900 transition-colors duration-150 hover:text-blue-800"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-blue-800 text-white">
            <Users className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="text-base font-semibold tracking-tight">
            GDArena
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {rightSlot ?? (
            <nav className="flex items-center gap-4 text-sm font-medium">
              <Link
                href="/"
                className="text-slate-600 transition-colors duration-150 hover:text-slate-900"
              >
                Create Room
              </Link>
              <Link
                href="/join"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50"
              >
                Join Room
              </Link>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}

