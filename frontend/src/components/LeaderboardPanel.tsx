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
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-slate-900">
            Live Leaderboard
          </h2>
        </div>
        <span className="text-xs text-slate-500">Server-scored</span>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-xs text-slate-500">
          Leaderboard populates once participants join.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <th className="py-2 pl-4 pr-2">#</th>
                <th className="px-2 py-2">Participant</th>
                <th className="px-2 py-2 text-right">Turns</th>
                <th className="px-2 py-2 text-right">Avg</th>
                <th className="px-2 py-2 text-right">Adj</th>
                <th className="py-2 pl-2 pr-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const isYou = youId !== null && row.participant_id === youId;
                return (
                  <tr
                    key={row.participant_id}
                    className={isYou ? "bg-blue-50" : "bg-white"}
                  >
                    <td className="py-2.5 pl-4 pr-2 font-semibold text-slate-500 tabular-nums">
                      {row.rank}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-900">
                          {row.name}
                        </span>
                        {isYou && (
                          <span className="text-[10px] font-medium text-blue-800">
                            (You)
                          </span>
                        )}
                        {row.is_ai && (
                          <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-600">
                            <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                            AI
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-slate-600 tabular-nums">
                      {row.turns}
                    </td>
                    <td className="px-2 py-2.5 text-right text-slate-600 tabular-nums">
                      {formatScore(row.average_turn_score)}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-right font-medium tabular-nums ${
                        row.adjustments > 0
                          ? "text-green-700"
                          : row.adjustments < 0
                          ? "text-red-700"
                          : "text-slate-400"
                      }`}
                    >
                      {row.adjustments === 0 ? "0" : formatDelta(row.adjustments)}
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right font-semibold text-slate-900 tabular-nums">
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

