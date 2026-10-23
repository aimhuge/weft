"use client";

// What sits under a thread's messages in ThreadView: a pending permission request (when it isn't a question, which
// the reply box asks) and the reply box, or just the status strip where the review panel stands in for the box or
// nothing can be sent. Both read what they can offer from the thread's transport (lib/thread-transport.ts): Wait,
// folder grants and "!" commands only where the Mac itself runs the card.
import type { ReactNode } from "react";
import type { PlanResets } from "@/lib/schedule";
import { turnCutOff } from "@/lib/reply-mode";
import { modelOn } from "@/lib/new-thread";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Card } from "@/lib/types";
import CrashGuard from "./CrashGuard";
import { guarded } from "./guarded";
import Icon from "./Icon";
import PermissionInput, { PermissionActions } from "./PermissionInput";
import type { QuestionProps } from "./QuestionForm";
import StatusStrip from "./StatusStrip";

// Loaded in its own CrashGuard (components/guarded.tsx): a reply box that fails, even as its module loads,
// leaves the thread readable.
const ReplyBox = guarded(() => import("./ReplyBox"), { what: "reply box", className: "mx-4 my-2" });

// The request under the thread, with its answers unless the thread is read-only here. answer(allow) marks it answered.
export function PermissionRequest({ card, readOnly, answered, answer }: { card: Card; readOnly: boolean; answered: boolean; answer: (allow: boolean) => void }) {
  const { grantFolder, waitPermission } = useThreadTransport();
  const pending = card.pending;
  if (!pending || pending.questions) return null;

  // "This card" / "Always" on an outside-folder prompt: grant the folder, then allow the call (lib/folder-guard.ts).
  const grant = (scope: "card" | "always") => {
    const dir = pending.readScope?.directory;
    if (!dir || !grantFolder) return;
    void grantFolder(card.id, dir, scope).catch(() => {}).finally(() => answer(true));
  };

  return (
    <CrashGuard key={pending.id} what="permission request" className="mx-4 my-2">
      <div data-human-only className="flex shrink-0 flex-col border-t border-warn/40 bg-warn-soft px-4 py-3">
        <div className="flex items-start gap-2 text-[13px] font-medium text-ink">
          <Icon name="lock" size={14} className="mt-0.5 text-warn" />
          <span>{pending.title}</span>
        </div>
        <PermissionInput input={pending.input} edit={pending.edit} previewUrl={pending.previewUrl} askedBy={card.title} why={pending.why} />
        {!readOnly && (
          <PermissionActions
            pending={pending}
            answered={answered}
            onAnswer={answer}
            onWait={waitPermission && (() => void waitPermission(card.id, pending.id).catch(() => {}))}
            onGrant={grantFolder && grant}
          />
        )}
      </div>
    </CrashGuard>
  );
}

type EditLast = { text: string; canRewind: boolean; fileEdits: number; onEdit: (text: string) => Promise<void> };

// The reply box, or (show false: the review panel stands in, or nothing can be sent) the status strip on its own, so
// the context and limits stay in view.
export function ThreadReply({ card, show, live, placeholder, question, scheduling, editLast, onEditing, onSend }: {
  card: Card;
  show: boolean;
  live: boolean;
  placeholder: string;
  question?: QuestionProps & { key: string };
  scheduling?: { resets: PlanResets };
  editLast?: EditLast;
  onEditing: (editing: boolean) => void;
  onSend: (text: string) => Promise<void>;
}): ReactNode {
  const transport = useThreadTransport();
  const { shell } = transport;
  const { fresh } = transport;
  const cache = card.stats?.cache;
  const status = <StatusStrip stats={card.stats} cwd={card.cwd} backend={card.backend} />;
  if (!show) return <div className="shrink-0 border-t border-line px-4 py-1.5">{status}</div>;
  return (
    <ReplyBox key={card.id} question={question} cardId={card.id} cwd={card.cwd} live={live} placeholder={placeholder} suggestion={card.suggestion}
      sendLater={scheduling && { backend: card.backend, resets: scheduling.resets, scheduled: card.scheduled ?? [] }}
      status={status}
      stale={cache && fresh ? { cache, onFresh: (message) => fresh(card.id, message) } : undefined}
      cutOff={turnCutOff(card)}
      // No live session: a model/CLI was just switched (lib/backend-switch.ts clears sessionId), or the
      // card was never started. A long-running card whose cache just lapsed still has sessionId set, so
      // this is false there — Continue still works on cold cache with history.
      noPriorContext={!card.sessionId}
      fiveHour={card.stats?.fiveHour}
      backend={card.backend}
      // The model the thread runs on: the one it was started with, else the one its session runs on
      // (lib/new-thread.ts modelOn picks the card's own model only when it fits the CLI).
      model={modelOn(card.backend, card.model) ?? card.stats?.runsOn?.model}
      editLast={editLast} onEditing={onEditing}
      onSend={onSend} onShell={shell && ((command) => shell(card.id, command))} onStop={() => transport.stop(card.id)} />
  );
}
