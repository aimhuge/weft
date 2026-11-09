"use client";

import type { PendingSql, SqlVerdict } from "@/lib/types";
import { Spinner } from "./Icon";
import { BUTTON_SECONDARY_SMALL as SECONDARY } from "./button-styles";

// The SQL behind a database prompt (lib/db-calls.ts) and a second model's review of it (lib/sql-review.ts), above
// Accept / Decline: the verdict first, each destructive statement in plain words, what's lost and what looks wrong,
// then the SQL itself folded, its flagged lines marked. The prompt never waits on the review; it fills in here.

const VERDICT: Record<SqlVerdict, { label: string; tone: string }> = {
  safe: { label: "Safe", tone: "bg-ok-soft text-ok" },
  access: { label: "Changes access", tone: "bg-warn-soft text-warn" },
  deletes: { label: "Deletes data", tone: "bg-danger-soft text-danger" },
  unknown: { label: "Can't tell", tone: "bg-panel text-muted" },
};

function Verdict({ sql }: { sql: PendingSql }) {
  const { review } = sql;
  if (!review)
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Spinner size={12} /> A second model is reading the SQL…
      </div>
    );
  const v = VERDICT[review.verdict];
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-semibold ${v.tone}`}>{v.label}</span>
      <span className="min-w-0 text-ink">{review.error ? `The review didn't finish (${review.error}). Read the SQL below.` : review.summary}</span>
    </div>
  );
}

function Findings({ sql }: { sql: PendingSql }) {
  const review = sql.review;
  if (!review || review.error) return null;
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      {review.concerns.map((c) => (
        <p key={c} className="text-danger">⚠ {c}</p>
      ))}
      {review.loss && <p className="text-ink"><span className="font-medium">Lost:</span> {review.loss}</p>}
      {review.statements.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {review.statements.map((s, i) => (
            <li key={i} className="text-muted">
              <code className="font-mono text-[11px] text-faint">{s.sql}</code> {s.does}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DECLINE_WHY: Record<Exclude<SqlVerdict, "safe">, string> = {
  deletes: "it deletes data",
  access: "it changes who can read or write",
  unknown: "the review can't tell what it does",
};

// Flagged SQL the review hasn't called Safe (or hasn't read yet): the prompt's buttons lead with Decline / Deny, and
// this line beside them says why. Undefined when the SQL isn't risky.
// What it loses comes first, from the static scan (lib/sql-loss.ts), so it's named before the review lands.
export function riskySql(sql: PendingSql | undefined): string | undefined {
  if (!sql?.flagged.length || sql.review?.verdict === "safe") return undefined;
  if (sql.loses) return `Suggested: Decline. It ${sql.loses}.`;
  return `Suggested: Decline. ${sql.review ? `${DECLINE_WHY[sql.review.verdict].replace(/^./, (c) => c.toUpperCase())}.` : "Wait for the review, or read the SQL."}`;
}

// That line, beside the buttons.
export function DeclineWhy({ why }: { why?: string }) {
  return why ? <span className="self-center text-[11.5px] text-muted">{why}</span> : null;
}

export default function SqlReview({ sql }: { sql: PendingSql }) {
  const lines = sql.sql.split("\n");
  const flagged = new Set(sql.flagged);
  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-sql-review>
      <Verdict sql={sql} />
      <Findings sql={sql} />
      <details className="rounded border border-line bg-panel">
        <summary className="cursor-pointer px-2 py-1 text-[11.5px] text-muted">
          {sql.name ? `${sql.name} · ` : ""}
          {sql.tool} · {lines.length} line{lines.length === 1 ? "" : "s"}
          {flagged.size > 0 && <span className="text-danger"> · {flagged.size} flagged</span>}
        </summary>
        <pre className="max-h-64 overflow-auto px-2 pb-1 font-mono text-[11px] leading-[1.45] text-ink">
          {lines.map((line, i) => (
            <div key={i} className={flagged.has(i) ? "bg-danger-soft text-danger" : undefined}>
              <span className="inline-block w-8 select-none pr-2 text-right text-faint">{i + 1}</span>
              {line || " "}
            </div>
          ))}
        </pre>
      </details>
    </div>
  );
}

// "Allow safe SQL on this card": on a prompt the review calls Safe, turn the card's switch on and accept this one. From
// then on its Safe prompts go through unasked (lib/db-calls.ts). Absent where the transport can't set it, or it's on.
export function safeForCard(sql: PendingSql | undefined, on: boolean | undefined, answered: boolean, allow: (() => void) | undefined) {
  if (!allow || on || sql?.review?.verdict !== "safe") return undefined;
  return (
    <button key="safe" onClick={allow} disabled={answered} className={SECONDARY} title="Accept this, and every database prompt on this card the review calls Safe">
      Allow safe SQL on this card
    </button>
  );
}
