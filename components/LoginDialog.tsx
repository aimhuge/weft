"use client";

import { useEffect, useEffectEvent, useRef, useState, type SubmitEvent } from "react";
import { api } from "@/lib/client";
import type { Backend, LoginTrial, LoginView } from "@/lib/types";
import { useAccount } from "@/lib/use-account";
import Icon, { Spinner } from "./Icon";
import Modal from "./Modal";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./button-styles";

const NAMES: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli", codex: "Codex", goose: "Goose" };

// How long "Logged in" shows before the pop-up closes itself.
const DONE_MS = 2000;

type Action = "start" | "input" | "cancel" | "terminal";

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function openUrl(url: string) {
  if (window.weft) window.weft.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

// The CLI's output, kept scrolled to the newest line.
function Output({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-muted"
    >
      {text.trim() || "No output yet."}
    </pre>
  );
}

// Why Weft's Puku trial didn't cover this login (lib/puku-trial.ts). Signed out of Weft, it offers Weft sign-in:
// once you're in, the server gets a trial token and runs the thread again, and this pop-up closes.
function TrialNote({ trial }: { trial: LoginTrial }) {
  const { busy, waiting, error, signIn } = useAccount();
  if (trial.reason !== "signed-out") {
    return (
      <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[12.5px] text-muted">
        {trial.message} Log in to Puku below to keep going.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-sunken px-3 py-2">
      <p className="flex-1 text-[12.5px] text-ink">
        Try Puku free: sign in to your Weft account and this thread runs on Weft&apos;s Puku trial, no Puku account needed.
        Or log in to Puku below.
        {error && <span className="block text-danger">{error}</span>}
      </p>
      <button onClick={() => void signIn("github")} disabled={busy !== null || waiting !== null} className={BUTTON_PRIMARY}>
        {waiting ? <Spinner size={13} /> : <Icon name="github" size={14} />} {waiting ? "Signing in…" : "Sign in to Weft"}
      </button>
    </div>
  );
}

export default function LoginDialog({ login, onClose }: { login: LoginView; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cancel aborts the in-flight request and always closes the dialog, so the
  // user is never trapped if the server is slow or the CLI is wedged.
  const abortRef = useRef<AbortController | null>(null);

  const close = useEffectEvent(onClose);

  // Done closes itself after a moment; a cancelled login has nothing left to show.
  useEffect(() => {
    if (login.state === "cancelled") {
      close();
      return;
    }
    if (login.state !== "done") return;
    const timer = setTimeout(() => close(), DONE_MS);
    return () => clearTimeout(timer);
  }, [login.state]);

  // If the dialog unmounts mid-request, abort it so the server call unwinds.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function act(action: Action, text?: string, signal?: AbortSignal) {
    setBusy(true);
    setError(null);
    try {
      await api.login(login.backend, action, text, signal);
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code.trim()) {
      setCodeError("Paste the code first.");
      return;
    }
    if (await act("input", code.trim())) setCode("");
  }

  function cancel() {
    // Abort any in-flight request first so a stuck POST doesn't keep us waiting.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // The server's cancel is idempotent and we don't need its response to close
    // the dialog. Fire the request (with the abort signal so a slow server can't
    // pin us) and close immediately, then clear the ref when it settles so we
    // don't leak a reference to an aborted controller.
    void act("cancel", undefined, controller.signal).finally(() => {
      if (abortRef.current === controller) abortRef.current = null;
    });
    onClose();
  }

  if (login.state === "cancelled") return null;

  const name = NAMES[login.backend];

  return (
    <Modal title={`Log in to ${name}`} onClose={onClose} keepOnBackdrop className="w-full max-w-[520px]">

        <div className="flex flex-col gap-4 px-5 py-4">
          {login.trial && login.state !== "done" && <TrialNote trial={login.trial} />}
          {login.state === "running" && (
            <>
              <div className="flex items-start gap-2.5 text-[13px] text-ink">
                <span className="mt-0.5 text-accent">
                  <Spinner />
                </span>
                <p>Finish signing in in your browser. This window closes when you&apos;re done.</p>
              </div>

              {login.url && (
                <div>
                  <button onClick={() => {
                      if (login.url) openUrl(login.url);
                    }} className={BUTTON_PRIMARY}>
                    <Icon name="globe" size={14} /> Open login page
                  </button>
                </div>
              )}

              <form onSubmit={(e) => void sendCode(e)} className="flex flex-col gap-1.5">
                <label htmlFor="login-code" className="text-[12px] font-medium text-muted">
                  Paste a code from the login page
                </label>
                <div className="flex gap-2">
                  <input
                    id="login-code"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Only if the CLI asks for one"
                    className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-accent"
                  />
                  <button type="submit" disabled={busy} className={`${BUTTON_SECONDARY} inline-flex items-center gap-1.5`}>
                    <Icon name="send" size={13} /> Send
                  </button>
                </div>
                {codeError && <p className="text-[12.5px] text-danger">{codeError}</p>}
              </form>

              <details className="group">
                <summary className="cursor-pointer select-none text-[12px] font-medium text-muted hover:text-ink">
                  CLI output
                </summary>
                <div className="mt-2">
                  <Output text={login.output} />
                </div>
              </details>
            </>
          )}

          {login.state === "terminal" && (
            <div className="flex items-start gap-2.5 text-[13px] text-ink">
              <span className="mt-0.5 text-accent">
                <Spinner />
              </span>
              <p>Finish signing in in the Terminal window. This closes when you&apos;re logged in.</p>
            </div>
          )}

          {login.state === "done" && (
            <div className="flex items-center gap-2.5 text-[13px] text-ink">
              <Icon name="check" size={16} className="text-ok" />
              <p>Logged in. Retrying your thread…</p>
            </div>
          )}

          {login.state === "failed" && (
            <>
              <div className="flex items-start gap-2.5 text-[13px] text-ink">
                <Icon name="alert" size={16} className="mt-0.5 text-warn" />
                <p>Login didn&apos;t finish.</p>
              </div>
              <Output text={login.output} />
            </>
          )}

          {error && <p className="break-words text-[12.5px] text-danger">{error}</p>}
        </div>

        {login.state === "running" && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={() => void act("terminal")} disabled={busy} className={BUTTON_SECONDARY}>
              Use Terminal instead
            </button>
            <button onClick={cancel} className={BUTTON_SECONDARY}>
              Cancel
            </button>
          </div>
        )}

        {login.state === "terminal" && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={cancel} className={BUTTON_SECONDARY}>
              Cancel
            </button>
          </div>
        )}

        {login.state === "failed" && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={onClose} className={BUTTON_SECONDARY}>
              Close
            </button>
            <button onClick={() => void act("terminal")} disabled={busy} className={BUTTON_SECONDARY}>
              Use Terminal instead
            </button>
            <button onClick={() => void act("start")} disabled={busy} className={BUTTON_PRIMARY}>
              <Icon name="reload" size={13} /> Try again
            </button>
          </div>
        )}
    </Modal>
  );
}
