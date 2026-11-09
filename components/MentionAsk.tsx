"use client";

// The line above a shared card's reply box when a message @mentions someone who can't open its link yet
// (lib/use-mention-ask.ts): "Give @x access?" before it's sent, then who got an email and who needs the link from you.
// Transient: it shows only while there's something to say, so the composer keeps its height otherwise.
import type { ReactNode } from "react";
import { useMentionAsk, type MentionAsk as Ask } from "@/lib/use-mention-ask";
import type { Card } from "@/lib/types";
import type { GrantOutcome } from "@/lib/share-grant-types";
import { CopyLinkInline } from "./SharePeople";

const BTN = "rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-ink hover:bg-sunken";
const at = (logins: string[]) => logins.map((l) => `@${l}`).join(", ");

export function MentionAskBar({ ask, outcomes, url, onDismiss }: { ask: Ask | null; outcomes: GrantOutcome[] | null; url: string | null; onDismiss: () => void }) {
  if (ask) {
    return (
      <div role="alertdialog" aria-label="Share with mentioned people" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-accent-soft px-2.5 py-1.5 text-[12.5px] text-ink">
        <span className="min-w-0 flex-1">
          Give {at(ask.logins)} access to this shared thread? They sign in with GitHub to open it.
        </span>
        <button type="button" className={`${BTN} border-accent font-medium`} autoFocus onClick={() => ask.answer(true)}>
          Give access &amp; send
        </button>
        <button type="button" className={BTN} onClick={() => ask.answer(false)}>
          Send without
        </button>
      </div>
    );
  }
  if (!outcomes) return null;
  const emailed = outcomes.filter((o) => o.ok && o.notice === "emailed").map((o) => o.login);
  const needLink = outcomes.filter((o) => o.ok && o.notice !== "emailed").map((o) => o.login);
  const failed = outcomes.filter((o): o is Extract<GrantOutcome, { ok: false }> => !o.ok);
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-sunken px-2.5 py-1.5 text-[12px] text-ink">
      {emailed.length > 0 && <span>{at(emailed)} can open it and got an email.</span>}
      {needLink.length > 0 && (
        <span className="text-warn">
          {at(needLink)} can open it, but no email is on file: send them the link. {url && <CopyLinkInline url={url} />}
        </span>
      )}
      {failed.map((f) => (
        <span key={f.login} className="text-danger">
          @{f.login}: {f.error}
        </span>
      ))}
      <button type="button" aria-label="Dismiss" className="ml-auto text-muted hover:text-ink" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

// The reply box's send, asking first when a message mentions someone new, and the bar to draw above the box.
export function useMentionSend(card: Pick<Card, "id" | "share">, onSend: (text: string) => Promise<void>, enabled: boolean): { send: (text: string) => Promise<void>; bar: ReactNode } {
  const mention = useMentionAsk(card.id, card.share?.id, enabled);
  const send = async (text: string) => {
    await mention.before(text);
    return onSend(text);
  };
  const bar = (mention.ask || mention.outcomes) && (
    <div className="border-t border-line px-3 pt-2">
      <MentionAskBar ask={mention.ask} outcomes={mention.outcomes} url={card.share?.url ?? null} onDismiss={mention.dismiss} />
    </div>
  );
  return { send, bar };
}
