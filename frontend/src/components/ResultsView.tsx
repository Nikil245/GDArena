"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Award,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  RefreshCw,
} from "lucide-react";
import { fetchReport } from "@/lib/api";
import {
  formatDelta,
  formatEndReason,
  formatScore,
  formatSeconds,
} from "@/lib/format";
import type {
  FinalReport,
  LeaderboardRow,
  ReportStatus,
  Room,
  TimerState,
  TranscriptEntry,
} from "@/lib/types";

interface ResultsViewProps {
  room: Room;
  timer: TimerState;
  leaderboard: LeaderboardRow[];
  transcript: TranscriptEntry[];
  reportStatus: ReportStatus;
  report: FinalReport | null;
  youId: number | null;
}

export function ResultsView({
  room,
  timer,
  leaderboard,
  transcript,
  reportStatus,
  report,
  youId,
}: ResultsViewProps) {
  const [fallbackReport, setFallbackReport] = useState<FinalReport | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const activeReport = report ?? fallbackReport;

  // Fallback REST check if the report is still generating or page was refreshed
  useEffect(() => {
    if (activeReport || reportStatus === "failed") return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetchReport(room.code);
        if (cancelled) return;
        if (res.status === "ready") {
          setFallbackReport(res.report);
          setPollError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setPollError(
          err instanceof Error ? err.message : "Could not load final report."
        );
      }
    };

    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeReport, reportStatus, room.code]);

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 uppercase tracking-wider text-slate-700">
                Session Complete
              </span>
              <span>{formatEndReason(room.end_reason)}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                Elapsed {formatSeconds(timer.elapsed_seconds)}
              </span>
              <span>·</span>
              <span>
                {transcript.length}{" "}
                {transcript.length === 1 ? "turn" : "turns"}
              </span>
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">
              {room.topic}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/"
              className="rounded bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-900"
            >
              New Discussion
            </Link>
          </div>
        </div>
      </section>

      {/* Best performer or generating state */}
      {!activeReport && reportStatus !== "failed" && (
        <section className="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <RefreshCw
              className="h-5 w-5 text-blue-800"
              strokeWidth={1.75}
            />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Generating Final Evaluation Report
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Finalising per-turn scores and compiling participant strengths
                and improvement areas. This updates automatically.
              </p>
            </div>
          </div>
        </section>
      )}

      {(reportStatus === "failed" || pollError) && !activeReport && (
        <section className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="font-semibold">Final report unavailable</p>
            <p className="mt-0.5 text-xs">
              {pollError ??
                "The server could not generate the narrative report. Final scores are shown below."}
            </p>
          </div>
        </section>
      )}

      {activeReport?.best_performer && (
        <section className="rounded-md border-2 border-blue-800 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-blue-200 bg-blue-50 text-blue-800">
                <Award className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">
                  Best Performer
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {activeReport.best_performer.name}
                  </h2>
                  {activeReport.best_performer.is_ai && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      <Bot className="h-3 w-3" strokeWidth={1.75} />
                      AI
                    </span>
                  )}
                </div>
                {activeReport.best_performer.reason && (
                  <p className="mt-1 text-sm text-slate-600">
                    {activeReport.best_performer.reason}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 rounded border border-slate-200 bg-slate-50 px-4 py-2 text-right">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Total Score
              </span>
              <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                {formatScore(activeReport.best_performer.total_score)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Final Leaderboard */}
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Final Leaderboard
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <th className="py-2.5 pl-5 pr-2">Rank</th>
                <th className="px-3 py-2.5">Participant</th>
                <th className="px-3 py-2.5 text-right">Turns</th>
                <th className="px-3 py-2.5 text-right">Relevance</th>
                <th className="px-3 py-2.5 text-right">Clarity</th>
                <th className="px-3 py-2.5 text-right">Content</th>
                <th className="px-3 py-2.5 text-right">Teamwork</th>
                <th className="px-3 py-2.5 text-right">Adj</th>
                <th className="py-2.5 pl-3 pr-5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaderboard.map((row) => {
                const isBest =
                  activeReport?.best_performer?.participant_id ===
                  row.participant_id;
                const isYou = youId !== null && row.participant_id === youId;
                return (
                  <tr
                    key={row.participant_id}
                    className={
                      isBest
                        ? "bg-blue-50"
                        : isYou
                        ? "bg-slate-50"
                        : "bg-white"
                    }
                  >
                    <td className="py-3 pl-5 pr-2 font-semibold text-slate-600 tabular-nums">
                      #{row.rank}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">
                          {row.name}
                        </span>
                        {isYou && (
                          <span className="text-xs font-medium text-blue-800">
                            (You)
                          </span>
                        )}
                        {row.is_ai && (
                          <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                            AI
                          </span>
                        )}
                        {isBest && (
                          <span className="rounded bg-blue-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Best
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 tabular-nums">
                      {row.turns}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 tabular-nums">
                      {formatScore(row.average.relevance)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 tabular-nums">
                      {formatScore(row.average.clarity)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 tabular-nums">
                      {formatScore(row.average.content)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 tabular-nums">
                      {formatScore(row.average.teamwork)}
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-medium tabular-nums ${
                        row.adjustments > 0
                          ? "text-green-700"
                          : row.adjustments < 0
                          ? "text-red-700"
                          : "text-slate-400"
                      }`}
                    >
                      {row.adjustments === 0 ? "0" : formatDelta(row.adjustments)}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right font-semibold text-slate-900 tabular-nums">
                      {formatScore(row.total_score)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-Participant Reports */}
      {activeReport && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Participant Evaluations
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            {activeReport.participants.map((p) => {
              const isBest =
                activeReport.best_performer?.participant_id ===
                p.participant_id;
              return (
                <article
                  key={p.participant_id}
                  className={`rounded-md bg-white p-5 ${
                    isBest
                      ? "border-2 border-blue-800"
                      : "border border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500 tabular-nums">
                          #{p.rank}
                        </span>
                        <h3 className="text-base font-semibold text-slate-900">
                          {p.name}
                        </h3>
                        {p.is_ai && (
                          <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                            AI
                          </span>
                        )}
                        {isBest && (
                          <span className="rounded bg-blue-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Best Performer
                          </span>
                        )}
                      </div>
                      {p.persona && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {p.persona.label}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="block text-lg font-semibold text-slate-900 tabular-nums">
                        {formatScore(p.total_score)}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {p.turns} {p.turns === 1 ? "turn" : "turns"}
                      </span>
                    </div>
                  </div>

                  {p.summary && (
                    <p className="mt-3 text-sm text-slate-700">{p.summary}</p>
                  )}

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-green-800">
                        Strengths
                      </h4>
                      {p.strengths.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          No recorded strengths.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {p.strengths.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <CheckCircle2
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700"
                                strokeWidth={1.75}
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Improvements
                      </h4>
                      {p.improvements.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          No items listed.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {p.improvements.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <ArrowUpRight
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-800"
                                strokeWidth={1.75}
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Collapsible transcript archive */}
      <section className="rounded-md border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowTranscript((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-slate-50"
        >
          <span>Full Discussion Transcript ({transcript.length} turns)</span>
          {showTranscript ? (
            <ChevronUp className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          )}
        </button>

        {showTranscript && (
          <div className="divide-y divide-slate-100 border-t border-slate-200">
            {transcript.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">
                No turns were recorded during this session.
              </p>
            ) : (
              transcript.map((entry) => (
                <div key={entry.turn_id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        {entry.name}
                      </span>
                      {entry.is_ai && (
                        <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          AI
                        </span>
                      )}
                      <span className="text-slate-400">Turn #{entry.seq}</span>
                    </div>
                    {entry.turn_score !== null && (
                      <span className="text-xs font-semibold text-blue-800 tabular-nums">
                        {formatScore(entry.turn_score)} / 10
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700">{entry.text}</p>
                  {entry.comment && (
                    <p className="mt-1 text-xs text-slate-500">
                      Comment: {entry.comment}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}

