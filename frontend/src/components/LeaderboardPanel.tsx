"use client";

import { BarChart3, Bot } from "lucide-react";
import { formatDelta, formatScore } from "@/lib/format";
import type { LeaderboardRow } from "@/lib/types";

interface LeaderboardPanelProps {
  rows: LeaderboardRow[];
  youId: number | null;
}

export function LeaderboardPanel({ rows, youId }: LeaderboardPanelProps) {
  return (
    <section className="ui-card">
      <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
          <h2 className="text-card-title font-semibold text-ink">
            Live Leaderboard
          </h2>
        </div>
        <span className="text-caption text-ink-muted">Server-scored</span>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-caption text-ink-muted">
          Leaderboard populates once participants join.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-caption">
            <thead>
              <tr className="border-b border-line bg-subtle text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                <th className="py-2 pl-3 pr-1.5 sm:pl-4 sm:pr-2">#</th>
                <th className="px-1.5 py-2 sm:px-2">Participant</th>
                <th className="px-1.5 py-2 text-right sm:px-2">Turns</th>
                <th className="px-1.5 py-2 text-right sm:px-2">Avg</th>
                <th className="px-1.5 py-2 text-right sm:px-2">Adj</th>
                <th className="py-2 pl-1.5 pr-3 text-right sm:pl-2 sm:pr-4">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((row) => {
                const isYou = youId !== null && row.participant_id === youId;
                return (
                  <tr
                    key={row.participant_id}
                    className={isYou ? "bg-accent-soft" : "bg-surface"}
                  >
                    <td className="py-2.5 pl-3 pr-1.5 font-semibold text-ink-muted tabular-nums sm:pl-4 sm:pr-2">
                      {row.rank}
                    </td>
                    <td className="px-1.5 py-2.5 sm:px-2">
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[105px] truncate font-medium text-ink sm:max-w-none">
                          {row.name}
                        </span>
                        {isYou && (
                          <span className="shrink-0 text-[10px] font-semibold text-accent-text">
                            (You)
                          </span>
                        )}
                        {row.is_ai && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-chip border border-line bg-muted px-1 py-0.5 text-[10px] font-medium text-ink-secondary">
                            <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                            AI
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-2.5 text-right text-ink-secondary tabular-nums sm:px-2">
                      {row.turns}
                    </td>
                    <td className="px-1.5 py-2.5 text-right text-ink-secondary tabular-nums sm:px-2">
                      {formatScore(row.average_turn_score)}
                    </td>
                    <td
                      className={`px-1.5 py-2.5 text-right font-medium tabular-nums sm:px-2 ${
                        row.adjustments > 0
                          ? "text-success-text"
                          : row.adjustments < 0
                          ? "text-danger-text"
                          : "text-ink-muted"
                      }`}
                    >
                      {row.adjustments === 0 ? "0" : formatDelta(row.adjustments)}
                    </td>
                    <td className="py-2.5 pl-1.5 pr-3 text-right font-semibold text-ink tabular-nums sm:pl-2 sm:pr-4">
                      {formatScore(row.total_score)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
