"use client";

import type { Dot, Mini } from "@/lib/show-rail";
import Icon from "./Icon";

export const DOT: Record<Exclude<Dot, "page">, string> = { ok: "bg-ok", wait: "bg-warn", err: "bg-danger", usr: "bg-faint" };
export const LABEL: Record<Exclude<Dot, "page">, string> = { ok: "Finished", wait: "Waiting", err: "Failed", usr: "You" };

type Props = { mini: Mini; active: boolean; onClick: () => void };

// A page the pane showed: its picture (lib/page-shots.ts), or a globe until one's captured, with a short
// name and time under it. The page on screen gets the accent ring.
export function PageTile({ mini, active, onScreen, shot, onClick }: Props & { onScreen: boolean; shot?: string }) {
  return (
    <button
      data-mini={mini.id}
      onClick={onClick}
      title={mini.url}
      aria-current={active || undefined}
      className="group flex flex-col gap-1 rounded-md p-0.5 text-left transition hover:-translate-y-px"
    >
      <span
        aria-label={onScreen ? "Page on screen" : "Page"}
        className={`relative block aspect-[4/5] w-full overflow-hidden rounded-[5px] border bg-canvas transition group-hover:border-accent ${
          onScreen ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : active ? "border-accent" : "border-line"
        }`}
      >
        {shot ? (
          <img src={shot} alt="" loading="lazy" draggable={false} className="size-full object-cover object-top" />
        ) : (
          <span className="flex size-full items-center justify-center text-faint">
            <Icon name="globe" size={16} />
          </span>
        )}
      </span>
      <span className="flex items-baseline justify-between gap-1 px-px text-[9px] leading-tight">
        <span className={`truncate ${onScreen ? "text-accent" : "text-ink"}`}>{mini.text}</span>
        <span className="shrink-0 text-faint">{mini.time}</span>
      </span>
    </button>
  );
}

// A turn or one of your messages: its dot and first words, light, so the pictures carry the rail.
export function TurnRow({ mini, active, onClick }: Props) {
  const dot = mini.dot === "page" ? "usr" : mini.dot;
  const yours = dot === "usr";
  return (
    <button
      data-mini={mini.id}
      onClick={onClick}
      title={mini.text}
      aria-current={active || undefined}
      className={`flex flex-col rounded-r-md border-l-2 px-1 py-1 text-left text-[10px] leading-[1.3] transition hover:bg-canvas ${
        active ? "border-accent bg-canvas" : "border-transparent"
      }`}
    >
      <span className={`line-clamp-3 break-words ${yours ? "text-muted italic" : "text-ink"}`}>
        <span className={`mr-1 mb-px inline-block size-[6px] rounded-full align-middle ${DOT[dot]}`} aria-label={LABEL[dot]} />
        {mini.text}
      </span>
      <span className="mt-0.5 text-[9px] text-faint">{mini.time}</span>
    </button>
  );
}
