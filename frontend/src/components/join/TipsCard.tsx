"use client";

import { Clock, CornerDownRight, MessageSquare } from "lucide-react";

const QUICK_TIPS = [
  {
    icon: MessageSquare,
    text: "Speak in short, clear points.",
  },
  {
    icon: CornerDownRight,
    text: "Respond to the previous speaker's idea.",
  },
  {
    icon: Clock,
    text: "Keep an eye on the timer.",
  },
] as const;

export function TipsCard() {
  return (
    <section className="ui-card p-5">
      <h2 className="text-card-title font-semibold text-ink">Quick Tips</h2>
      <ul className="mt-3 space-y-2.5">
        {QUICK_TIPS.map((tip) => {
          const Icon = tip.icon;
          return (
            <li
              key={tip.text}
              className="flex items-start gap-2.5 text-sm text-ink-secondary"
            >
              <Icon
                className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                strokeWidth={1.75}
              />
              <span>{tip.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

