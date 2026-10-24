import { useCallback, useState } from "react";
import { api } from "@/lib/client";
import { BACKENDS } from "@/lib/new-thread";
import type { Backend, Card, Column } from "@/lib/types";
import { BACKEND_LABELS } from "@/lib/types";
import Icon from "./Icon";
import Modal from "./Modal";
import Tip from "./Tip";

// "X threads are still running. Switch them after they finish?" — the user can tick
// "do not ask again" so future column switches just wait silently.
const ASK_KEY = "threadboard.switchAll.askWhenBusy";
const POLL_MS = 2_000;

function shouldAsk(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(ASK_KEY) !== "no";
}

function rememberAsk(ask: boolean) {
  if (typeof localStorage === "undefined") return;
  if (ask) localStorage.removeItem(ASK_KEY);
  else localStorage.setItem(ASK_KEY, "no");
}

interface PendingDialogProps {
  count: number;
  onClose: (wait: boolean, askAgain: boolean) => void | Promise<void>;
}

// Native confirms can't show a checkbox; this small modal does.
function PendingDialog({ count, onClose }: PendingDialogProps) {
  const [askAgain, setAskAgain] = useState(true);
  return (
    <Modal title="Threads still running" onClose={() => { void onClose(false, askAgain); }}>
      <div className="px-4 pb-4 pt-3 text-[13px] text-ink">
        <p>
          {count} thread{count > 1 ? "s are" : " is"} still running. Switch {count > 1 ? "them" : "it"} after {count > 1 ? "they" : "it"}{" "}
          finish{count > 1 ? "" : "es"}?
        </p>
        <label className="mt-3 flex items-center gap-2 text-faint">
          <input type="checkbox" checked={!askAgain} onChange={(e) => setAskAgain(!e.target.checked)} />
          Don&apos;t ask again
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => { void onClose(false, askAgain); }}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] hover:bg-sunken"
          >
            Skip {count > 1 ? "them" : "it"}
          </button>
          <button
            onClick={() => { void onClose(true, askAgain); }}
            className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90"
          >
            Wait
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The "Switch all to <other>" button at the top of the Running and Needs you columns.
// A confirm switches every idle card in the column to the other CLI; cards still running
// come back in `pending`, the user is asked whether to wait, and the dialog has a
// "do not ask again" tick that makes future switches just wait silently. The per-card
// endpoint decides whether to auto-replay the last user message (rate-limit cards) or
// just flip without replaying.
export function useSwitchAll({ byColumn, setToast, notify }: { byColumn: Map<Column, Card[]>; setToast: (msg: string) => void; notify: (err: unknown) => void }) {
  const [pending, setPending] = useState<{ ids: string[]; target: Backend; targetLabel: string } | null>(null);
  const send = useCallback(
    async (ids: string[], target: Backend, targetLabel: string) =>
      api.switchBackends(ids, target).then(
        (r) => {
          const ok = r.switched.length;
          const fail = r.failed.length;
          const plural = ok === 1 ? "" : "s";
          setToast(fail > 0 ? `Switched ${ok} thread${plural} to ${targetLabel}; ${fail} failed.` : `Switched ${ok} thread${plural} to ${targetLabel}.`);
          r.failed.forEach((f) => notify(`${f.id}: ${f.error}`));
          return r;
        },
        (err: unknown) => {
          notify(err);
          return null;
        },
      ),
    [setToast, notify],
  );
  const switchColumn = useCallback(
    async (column: Column) => {
      const list = byColumn.get(column) ?? [];
      if (!list.length) return;
      const counts: Record<Backend, number> = { claude: 0, puku: 0, codex: 0, goose: 0 };
      list.forEach((c) => {
        counts[c.backend]++;
      });
      const mostCommon = BACKENDS.reduce((best, backend) => counts[backend.id] > counts[best.id] ? backend : best);
      const target = BACKENDS[(BACKENDS.findIndex((backend) => backend.id === mostCommon.id) + 1) % BACKENDS.length]?.id ?? "claude";
      const targetLabel = BACKEND_LABELS[target];
      const columnLabel = column.replace("_", " ");
      if (!window.confirm(`Switch ${list.length} thread${list.length > 1 ? "s" : ""} in ${columnLabel} to ${targetLabel}?`)) return;
      const first = await send(list.map((c) => c.id), target, targetLabel);
      if (!first) return;
      if (first.pending.length) {
        setPending({ ids: first.pending, target, targetLabel });
      }
    },
    [byColumn, send],
  );
  const resolve = useCallback(
    async (wait: boolean, askAgain: boolean) => {
      if (!pending) return;
      rememberAsk(askAgain);
      const { ids, target, targetLabel } = pending;
      setPending(null);
      if (!wait) {
        setToast(`Switched ${ids.length > 0 ? "what we could" : "0 threads"}; ${ids.length} still running.`);
        return;
      }
      let stillPending = ids;
      while (stillPending.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
        const retried = await send(stillPending, target, targetLabel);
        if (!retried) return;
        stillPending = retried.pending;
        if (!stillPending.length) break;
        if (shouldAsk()) {
          setPending({ ids: stillPending, target, targetLabel });
          return;
        }
      }
    },
    [pending, send, setToast],
  );
  const dialog = pending ? <PendingDialog count={pending.ids.length} onClose={resolve} /> : null;
  return { switchColumn, dialog };
}

export function SwitchAllButton({ onClick }: { onClick: () => void }) {
  return (
    <Tip text="Switch all in-flight threads in this column to the other CLI" className="inline-flex">
      <button onClick={onClick} className="flex items-center gap-1 font-medium text-accent hover:opacity-80">
        <Icon name="forward" size={10} />
        Switch all
      </button>
    </Tip>
  );
}
