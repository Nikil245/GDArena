"use client";

import { useEffect, useRef } from "react";
import { Bot, MessageSquareText } from "lucide-react";
import { formatScore, formatTime } from "@/lib/format";
import type { ActivityNotice, TranscriptEntry } from "@/lib/types";

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  activity: ActivityNotice[];
  showComments?: boolean;
}

export function TranscriptPanel({
  entries,
  activity,
  showComments = false,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length, activity.length]);

  type FeedItem =
    | { kind: "entry"; ts: string; entry: TranscriptEntry }
    | { kind: "notice"; ts: string; notice: ActivityNotice };

  const feed: FeedItem[] = [
    ...entries.map((entry) => ({
      kind: "entry" as const,
      ts: entry.ended_at || entry.started_at,
      entry,
    })),
    ...activity.map((notice) => ({
      kind: "notice" as const,
      ts: notice.ts,
      notice,
    })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));

  return (
    <section className="flex flex-col rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquareText
            className="h-4 w-4 text-slate-500"
            strokeWidth={1.75}
          />
          <h2 className="text-sm font-semibold text-slate-900">
            Live Transcript
          </h2>
        </div>
        <span className="text-xs text-slate-500 tabular-nums">
          {entries.length} {entries.length === 1 ? "turn" : "turns"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[340px] space-y-3 overflow-y-auto p-4 lg:h-[380px]"
      >
        {feed.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-slate-500">
              No contributions yet
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Spoken turns from human and AI participants will appear here in
              real time.
            </p>
          </div>
        ) : (
          feed.map((item) => {
            if (item.kind === "notice") {
              return (
                <div
                  key={item.notice.id}
                  className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
                >
                  <span>{item.notice.message}</span>
                  <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                    {formatTime(item.notice.ts)}
                  </span>
                </div>
              );
            }

            const e = item.entry;
            return (
              <article
                key={e.turn_id}
                className="rounded-md border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-900">
                      {e.name}
                    </span>
                    {e.is_ai && (
                      <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        <Bot className="h-2.5 w-2.5" strokeWidth={1.75} />
                        AI
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      #{e.seq} · {formatTime(e.ended_at)}
                    </span>
                  </div>

                  {e.turn_score !== null ? (
                    <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-900 tabular-nums">
                      {formatScore(e.turn_score)} / 10
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">
                      Scoring...
                    </span>
                  )}
                </div>

                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                  {e.text}
                </p>

                {showComments && e.scores && (
                  <div className="mt-2 border-t border-slate-100 pt-2 text-xs">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 tabular-nums">
                      <span>Relevance: {e.scores.relevance}</span>
                      <span>Clarity: {e.scores.clarity}</span>
                      <span>Content: {e.scores.content}</span>
                      <span>Teamwork: {e.scores.teamwork}</span>
                    </div>
                    {e.comment && (
                      <p className="mt-1 text-slate-600">{e.comment}</p>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

