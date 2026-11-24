"use client";

import { modelLabel, runningOn } from "@/lib/new-thread";
import { BACKEND_LABELS, type Card } from "@/lib/types";
import Tip from "./Tip";

// The CLI's chip, coloured by CLI; given a card, it names the model and effort the thread runs on instead.
export default function BackendBadge({ backend, card }: { backend: Card["backend"]; card?: Card }) {
  const { model, effort } = card ? runningOn(card) : {};
  const label = model ? [modelLabel(model), effort].filter(Boolean).join(" · ") : BACKEND_LABELS[backend];
  const tone = backend === "puku" ? "bg-puku-soft text-puku" : backend === "codex" || backend === "antigravity" ? "bg-accent-soft text-accent" : "bg-claude-soft text-claude";
  const badge = <span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium ${tone}`}>{label}</span>;
  if (!model) return badge;
  const cli = BACKEND_LABELS[backend];
  const how = card?.effort ? "" : " (the CLI's default)";
  return <Tip text={`${cli} · ${model}${effort ? ` · ${effort} effort${how}` : ""}`}>{badge}</Tip>;
}
