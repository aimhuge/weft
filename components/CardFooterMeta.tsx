"use client";

import { findAgent } from "@/lib/agents";
import { useAgents } from "@/lib/use-agents";
import { activeAt } from "@/lib/board-view";
import { folderName, timeAgo } from "@/lib/format";
import { modelLabel, runningOn } from "@/lib/new-thread";
import { isBusy } from "@/lib/overlap";
import { sendsWhen } from "@/lib/schedule";
import { BACKEND_LABELS, type Backend, type Card } from "@/lib/types";
import Icon from "./Icon";

// Each CLI's own colour in the footer: puku has its own, the two plain CLIs (Codex, Goose)
// take the accent, Claude has none here and takes its own.
function cliColours(backend: Backend): { tone: string; dot: string } {
  if (backend === "puku") return { tone: "text-puku", dot: "bg-puku" };
  if (backend === "codex" || backend === "goose") return { tone: "text-accent", dot: "bg-accent" };
  return { tone: "text-claude", dot: "bg-claude" };
}

// The card footer's left side: CLI dot, folder (or "whole board" for the copilot), overlap, age, turns,
// scheduled sends, open elsewhere, and the card's issue and tags when it has no progress line.
export default function CardFooterMeta({ card, now, alsoHere, marks }: { card: Card; now: number; alsoHere: Card[]; marks: React.ReactNode }) {
  const { model, effort } = runningOn(card);
  const cli = BACKEND_LABELS[card.backend];
  const { tone, dot } = cliColours(card.backend);
  const cliTip = `${cli}${model ? ` on ${model}${effort ? ` · ${effort} effort` : ""}` : ""}${card.source === "claude-code" ? " · picked up from Claude Code" : ""}`;
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} title={cliTip} />
      {model && <span className={`shrink-0 whitespace-nowrap font-medium ${tone}`} title={cliTip}>{modelLabel(model)}</span>}
      {card.agent && <AgentMark agent={card.agent} />}
      <FolderOrBoard card={card} />
      {isBusy(card) && alsoHere.length > 0 && <OverlapHint others={alsoHere} />}
      <Age card={card} now={now} />
      {marks}
      {card.scheduled?.[0] && <NextSend scheduled={card.scheduled} now={now} />}
      {card.openElsewhere && <OpenElsewhere />}
    </span>
  );
}

// A thread that isn't Builder shows who it is (lib/agents.ts); Builder, every card's default, shows nothing, and so does
// an agent that was deleted.
function AgentMark({ agent }: { agent: string }) {
  const info = findAgent(agent, useAgents());
  if (!info) return null;
  return <span className="shrink-0 text-[11px] leading-none" title={`${info.name}: ${info.tagline}`}>{info.emoji}</span>;
}

function FolderOrBoard({ card }: { card: Card }) {
  if (card.role !== "copilot") return <span className="truncate font-medium text-muted" title={card.cwd}>{folderName(card.cwd)}</span>;
  return (
    <span className="flex shrink-0 items-center gap-1 font-medium text-accent" title="The copilot runs the whole board">
      <Icon name="sparkles" size={10} />
      whole board
    </span>
  );
}

function OverlapHint({ others }: { others: Card[] }) {
  return (
    <span className="shrink-0 font-medium text-warn" title={`Also running in this folder (shared working tree):\n${others.map((c) => c.title).join("\n")}`}>
      +{others.length} here
    </span>
  );
}

function Age({ card, now }: { card: Card; now: number }) {
  return (
    <span className="shrink-0 whitespace-nowrap">
      {timeAgo(activeAt(card), now).replace(" ago", "")}
      {card.turns ? ` · ${card.turns}t` : ""}
    </span>
  );
}

function NextSend({ scheduled, now }: { scheduled: NonNullable<Card["scheduled"]>; now: number }) {
  const next = scheduled[0];
  if (!next) return null;
  const icon = next.afterRestart || next.afterTurn || next.forSlot ? "reload" : "clock";
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-accent" title={`${scheduled.length} message${scheduled.length > 1 ? "s" : ""} scheduled; the next sends ${next.afterRestart ? "after Weft restarts" : sendsWhen(next, now)}`}>
      <Icon name={icon} size={10} />
      {sendsWhen(next, now)}
    </span>
  );
}

function OpenElsewhere() {
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted" title="This thread is open in the Claude app or a terminal right now">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      open
    </span>
  );
}
