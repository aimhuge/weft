"use client";

// A cron's on/off switch: the violet pill that a cron is on, grey when it is off. The thread header's
// popover (components/CronButton.tsx) and the rail's ⏰ Crons drawer (components/CronsDrawer.tsx) both
// put one beside a cron, so the switch itself is written once here.

export interface CronSwitchProps {
  // Whether the cron is on right now.
  enabled: boolean;
  // What the switch is called, for a screen reader: "Pause", or "Pause Nightly sweep".
  label: string;
  onToggle: () => void;
  // Extra class names on the switch, for where it sits in its row.
  className?: string;
}

export default function CronSwitch({ enabled, label, onToggle, className }: CronSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-4 w-7 shrink-0 rounded-full ${enabled ? "bg-[var(--cron)]" : "bg-line-strong"} ${className ?? ""}`}
    >
      <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}
