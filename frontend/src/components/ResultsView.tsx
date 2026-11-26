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
  const [fallbackReport, setFallbackReport] = useState<FinalReport | null>(
    null
  );
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
      <section className="ui-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-caption font-medium text-ink-muted">
              <span className="rounded-chip border border-line bg-muted px-2 py-0.5 uppercase tracking-wider text-ink-secondary">
                Session Complete
              </span>
              <span>{formatEndReason(room.end_reason)}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                Elapsed {formatSeconds(timer.elapsed_seconds)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {transcript.length}{" "}
                {transcript.length === 1 ? "turn" : "turns"}
              </span>
            </div>
            <h1 className="mt-2 break-words text-xl font-semibold text-ink">
              {room.topic}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link href="/" className="ui-btn-primary w-full sm:w-auto">
              New Discussion
            </Link>
          </div>
        </div>
      </section>

      {/* Best performer or generating state */}
      {!activeReport && reportStatus !== "failed" && (
        <section
          role="status"
          className="ui-card flex items-center justify-between gap-4 p-4 sm:p-5"
        >
          <div className="flex items-center gap-3">
            <RefreshCw
              className="h-5 w-5 shrink-0 text-accent"
              strokeWidth={1.75}
            />
            <div>
              <h2 className="text-card-title font-semibold text-ink">
                Generating Final Evaluation Report
              </h2>
              <p className="mt-0.5 text-caption text-ink-muted">
                Finalising per-turn scores and compiling participant strengths
                and improvement areas. This updates automatically.
              </p>
            </div>
          </div>
        </section>
      )}

      {(reportStatus === "failed" || pollError) && !activeReport && (
        <section
          role="alert"
          className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-bg p-4 text-sm text-danger-text shadow-card"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="font-semibold">Final report unavailable</p>
            <p className="mt-0.5 text-caption">
              {pollError ??
                "The server could not generate the narrative report. Final scores are shown below."}
            </p>
          </div>
        </section>
      )}

      {activeReport?.best_performer && (
        <section className="ui-card border-2 border-accent p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-soft text-accent">
                <Award className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-caption font-semibold uppercase tracking-wider text-accent-text">
                  Best Performer
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    {activeReport.best_performer.name}
                  </h2>
                  {activeReport.best_performer.is_ai && (
                    <span className="inline-flex items-center gap-0.5 rounded-chip border border-line bg-muted px-1.5 py-0.5 text-caption font-medium text-ink-secondary">
                      <Bot className="h-3 w-3" strokeWidth={1.75} />
                      AI
                    </span>
                  )}
                </div>
                {activeReport.best_performer.reason && (
                  <p className="mt-1 text-sm text-ink-secondary">
                    {activeReport.best_performer.reason}
                  </p>
                )}
              </div>
            </div>

            <div className="ui-card-subtle flex shrink-0 items-center justify-between px-4 py-2 sm:block sm:text-right">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Total Score
              </span>
              <span className="text-2xl font-semibold text-ink tabular-nums">
                {formatScore(activeReport.best_performer.total_score)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Final Leaderboard */}
      <section className="ui-card">
        <div className="border-b border-line-subtle px-4 py-3.5 sm:px-5">
          <h2 className="text-card-title font-semibold text-ink">
            Final Leaderboard
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-caption sm:text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                <th className="whitespace-nowrap py-2.5 pl-3 pr-2 sm:pl-5">
                  Rank
                </th>
                <th className="whitespace-nowrap px-3 py-2.5">Participant</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">
                  Turns
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">
                  Relevance
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">
                  Clarity
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">
                  Content
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">
                  Teamwork
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">
                  Adj
                </th>
                <th className="whitespace-nowrap py-2.5 pl-3 pr-3 text-right sm:pr-5">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
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
                        ? "bg-accent-soft"
                        : isYou
                        ? "bg-subtle"
                        : "bg-surface"
                    }
                  >
                    <td className="whitespace-nowrap py-3 pl-3 pr-2 font-semibold text-ink-muted tabular-nums sm:pl-5">
                      #{row.rank}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-ink">
                          {row.name}
                        </span>
                        {isYou && (
                          <span className="text-caption font-semibold text-accent-text">
                            (You)
                          </span>
                        )}
                        {row.is_ai && (
                          <span className="inline-flex items-center gap-0.5 rounded-chip border border-line bg-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
                            <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                            AI
                          </span>
                        )}
                        {isBest && (
                          <span className="rounded-chip bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Best
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-ink-secondary tabular-nums">
                      {row.turns}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-ink-secondary tabular-nums">
                      {formatScore(row.average.relevance)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-ink-secondary tabular-nums">
                      {formatScore(row.average.clarity)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-ink-secondary tabular-nums">
                      {formatScore(row.average.content)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-ink-secondary tabular-nums">
                      {formatScore(row.average.teamwork)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums ${
                        row.adjustments > 0
                          ? "text-success-text"
                          : row.adjustments < 0
                          ? "text-danger-text"
                          : "text-ink-muted"
                      }`}
                    >
                      {row.adjustments === 0 ? "0" : formatDelta(row.adjustments)}
                    </td>
                    <td className="whitespace-nowrap py-3 pl-3 pr-3 text-right font-semibold text-ink tabular-nums sm:pr-5">
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
          <h2 className="text-card-title font-semibold text-ink">
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
                  className={`ui-card p-4 sm:p-5 ${
                    isBest ? "border-2 border-accent" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-line-subtle pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-caption font-semibold text-ink-muted tabular-nums">
                          #{p.rank}
                        </span>
                        <h3 className="text-section-title font-semibold text-ink">
                          {p.name}
                        </h3>
                        {p.is_ai && (
                          <span className="inline-flex items-center gap-0.5 rounded-chip border border-line bg-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
                            <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                            AI
                          </span>
                        )}
                        {isBest && (
                          <span className="rounded-chip bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Best Performer
                          </span>
                        )}
                      </div>
                      {p.persona && (
                        <p className="mt-0.5 text-caption text-ink-muted">
                          {p.persona.label}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="block text-lg font-semibold text-ink tabular-nums">
                        {formatScore(p.total_score)}
                      </span>
                      <span className="text-[11px] text-ink-muted">
                        {p.turns} {p.turns === 1 ? "turn" : "turns"}
                      </span>
                    </div>
                  </div>

                  {p.summary && (
                    <p className="mt-3 text-sm text-ink-secondary">
                      {p.summary}
                    </p>
                  )}

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <h4 className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-success-text">
                        Strengths
                      </h4>
                      {p.strengths.length === 0 ? (
                        <p className="text-caption text-ink-muted">
                          No recorded strengths.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-caption text-ink-secondary">
                          {p.strengths.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <CheckCircle2
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-text"
                                strokeWidth={1.75}
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <h4 className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-ink-muted">
                        Improvements
                      </h4>
                      {p.improvements.length === 0 ? (
                        <p className="text-caption text-ink-muted">
                          No items listed.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-caption text-ink-secondary">
                          {p.improvements.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <ArrowUpRight
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
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
      <section className="ui-card">
        <button
          type="button"
          aria-expanded={showTranscript}
          onClick={() => setShowTranscript((v) => !v)}
          className="ui-focus flex min-h-[44px] w-full items-center justify-between rounded-card px-4 py-3.5 text-left text-card-title font-semibold text-ink transition-colors duration-150 hover:bg-subtle sm:px-5"
        >
          <span>Full Discussion Transcript ({transcript.length} turns)</span>
          {showTranscript ? (
            <ChevronUp className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
          ) : (
            <ChevronDown
              className="h-4 w-4 text-ink-muted"
              strokeWidth={1.75}
            />
          )}
        </button>

        {showTranscript && (
          <div className="divide-y divide-line-subtle border-t border-line-subtle">
            {transcript.length === 0 ? (
              <p className="p-5 text-caption text-ink-muted">
                No turns were recorded during this session.
              </p>
            ) : (
              transcript.map((entry) => (
                <div key={entry.turn_id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-caption">
                      <span className="font-semibold text-ink">
                        {entry.name}
                      </span>
                      {entry.is_ai && (
                        <span className="rounded-chip border border-line bg-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
                          AI
                        </span>
                      )}
                      <span className="text-ink-muted">Turn #{entry.seq}</span>
                    </div>
                    {entry.turn_score !== null && (
                      <span className="text-caption font-semibold text-accent-text tabular-nums">
                        {formatScore(entry.turn_score)} / 10
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 break-words text-sm text-ink-secondary">
                    {entry.text}
                  </p>
                  {entry.comment && (
                    <p className="mt-1 text-caption text-ink-muted">
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
