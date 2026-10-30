"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { addedMessage, answeredBy, isFilled, type AddedKey, type AskField } from "@/lib/secret-ask-batch";
import { vaultBridge } from "@/lib/vault-view";

// The open key asks in one thread, filled in together (lib/secret-ask-batch.ts). Each SecretAskInput reports its
// field here while it's open; Add (or Enter in any of them) puts every filled field in the vault, and the thread is
// told once, when no ask is left open. "Tell Claude now" tells it early, for a key the user means to skip.
export type SecretAskBatch = {
  report: (id: string, field: AskField | null) => void;
  submit: () => Promise<void>;
  tell: () => Promise<void>;
  saved: ReadonlySet<string>;
  filled: number;
  waiting: number;
  busy: boolean;
  error: string | null;
};

export function useSecretAskBatch(onSend?: (text: string) => Promise<void> | void): SecretAskBatch {
  const fields = useRef(new Map<string, AskField>());
  const [filled, setFilled] = useState(0);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<AddedKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recount = useCallback(() => setFilled([...fields.current.values()].filter(isFilled).length), []);
  const report = useCallback(
    (id: string, field: AskField | null) => {
      if (field) fields.current.set(id, field);
      else fields.current.delete(id);
      recount();
    },
    [recount],
  );

  const tell = useCallback(
    async (keys: AddedKey[] = added) => {
      if (!keys.length) return;
      setAdded([]);
      await onSend?.(addedMessage(keys));
    },
    [added, onSend],
  );

  const submit = useCallback(async () => {
    const bridge = vaultBridge();
    const todo = [...fields.current].filter(([, f]) => isFilled(f));
    if (!bridge || !todo.length || busy) return;
    setBusy(true);
    setError(null);
    const keys = [...added];
    const done = new Set<string>();
    try {
      for (const [id, f] of todo) {
        for (const env of f.environments) await bridge.set(f.ask.folder, f.ask.name, env, f.value);
        const key = { folder: f.ask.folder, name: f.ask.name, environments: f.environments };
        keys.push({ name: key.name, environments: key.environments });
        for (const [other, g] of fields.current) if (other === id || answeredBy(g, key)) done.add(other);
        for (const other of done) fields.current.delete(other);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaved((s) => new Set([...s, ...done]));
      recount();
      setBusy(false);
    }
    if (fields.current.size) setAdded(keys);
    else await tell(keys);
  }, [added, busy, recount, tell]);

  return useMemo(
    () => ({ report, submit, tell: () => tell(), saved, filled, waiting: added.length, busy, error }),
    [report, submit, tell, saved, filled, added.length, busy, error],
  );
}

const Batch = createContext<SecretAskBatch | null>(null);

export function SecretAskBatchProvider({ onSend, children }: { onSend?: (text: string) => Promise<void>; children: ReactNode }) {
  return <Batch.Provider value={useSecretAskBatch(onSend)}>{children}</Batch.Provider>;
}

// The thread's batch; a lone input outside a thread gets its own.
export function useAskBatch(own: SecretAskBatch): SecretAskBatch {
  return useContext(Batch) ?? own;
}
