"use client";

// "Sign in to Claude" on a worker of yours in Settings → Sync → Workers (docs/architecture/weft-worker.md#signing-claude-in).
// A worker runs as a background service, which can't answer the keychain prompt a desktop Claude login raises, so
// it signs in with a long-lived `claude setup-token` token. One click: the desktop runs setup-token itself and opens
// Claude's approval page in a window beside the button (electron/claude-sign-in.cjs); approve there and the token
// comes back here, never shown, and the server seals it to the worker's own key before it leaves this Mac. Where
// there's no desktop shell (or the window fails), you paste a token instead.

import { useState, type MouseEvent } from "react";
import { Spinner } from "./Icon";

const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const INPUT = "w-full rounded-md border border-line-strong bg-sunken px-2 py-1 text-[12.5px] text-ink";
const TOKEN = /^sk-ant-[\w-]{20,}$/;

type State = { step: "idle" | "approving" | "sending" | "sent" | "paste"; error?: string };

function PasteToken({ name, send, onSent }: { name: string; send: (token: string) => Promise<unknown>; onSent: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = TOKEN.test(token.trim());

  async function onSend() {
    setError(null);
    try {
      await send(token.trim());
      setToken("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className={SUBTLE}>
        Run <code className="rounded bg-sunken px-1">claude setup-token</code> in the terminal and paste the token it prints. It&apos;s sealed to {name}&apos;s own key.
      </p>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && void onSend()} placeholder="sk-ant-…" aria-label={`Claude token for ${name}`} className={INPUT} />
        <button type="button" onClick={() => void onSend()} disabled={!ok} className={`shrink-0 ${BUTTON}`}>
          Send
        </button>
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

export default function WorkerSignIn({ name, send }: { name: string; send: (token: string) => Promise<unknown> }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const bridge = typeof window === "undefined" ? undefined : window.weft?.claudeSignIn;

  async function onClick(e: MouseEvent<HTMLButtonElement>) {
    if (!bridge) {
      setState({ step: "paste" });
      return;
    }
    setState({ step: "approving" });
    const result = await bridge.start({ x: e.screenX, y: e.screenY });
    if (!result.token) {
      setState({ step: "idle", error: result.error ?? "No token came back." });
      return;
    }
    setState({ step: "sending" });
    try {
      await send(result.token);
      setState({ step: "sent" });
    } catch (err) {
      setState({ step: "idle", error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.step === "paste") return <PasteToken name={name} send={send} onSent={() => setState({ step: "sent" })} />;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {state.step === "approving" ? (
          <>
            <span className={`flex items-center gap-1.5 ${SUBTLE}`}>
              <Spinner size={11} /> Approve in the window beside this
            </span>
            <button type="button" onClick={() => bridge?.cancel()} className={BUTTON}>
              Cancel
            </button>
          </>
        ) : state.step === "sending" ? (
          <span className={`flex items-center gap-1.5 ${SUBTLE}`}>
            <Spinner size={11} /> Sending to {name}
          </span>
        ) : state.step === "sent" ? (
          <span className={SUBTLE}>Signed in. {name} restarts with it in a few seconds.</span>
        ) : (
          <button type="button" onClick={(e) => void onClick(e)} className={BUTTON}>
            Sign in to Claude
          </button>
        )}
      </div>
      {state.error && (
        <p className="max-w-[280px] text-right text-[12.5px] text-danger">
          {state.error}{" "}
          <button type="button" onClick={() => setState({ step: "paste" })} className="underline">
            Paste a token instead
          </button>
        </p>
      )}
    </div>
  );
}
