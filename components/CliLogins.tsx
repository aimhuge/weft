"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Backend, CliStatus, LoginView } from "@/lib/types";
import Icon, { Spinner } from "./Icon";

const CLIS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
  { id: "codex", label: "Codex" },
];

// How often the panel re-reads the logins while it is open. A login finishes in the browser,
// outside Weft, so the panel has to look again to see it (GitHub issue #13).
const POLL_MS = 2000;

type LoginStatus =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; status: Record<Backend, CliStatus>; runs: LoginView[] };

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function statusLine(s: CliStatus | undefined): { text: string; dot: string } {
  if (!s) return { text: "Unknown", dot: "bg-faint" };
  if (s.error) return { text: s.error, dot: "bg-danger" };
  if (s.loggedIn) return { text: s.email ? `Logged in as ${s.email}` : "Logged in", dot: "bg-ok" };
  return { text: "Not logged in", dot: "bg-warn" };
}

// A login the server is still running: the button stays out of the way until it finishes, so a
// second click can't start a second `auth login` and kill the first (GitHub issue #13).
function liveRun(runs: LoginView[], backend: Backend): LoginView | undefined {
  return runs.find((run) => run.backend === backend && (run.state === "running" || run.state === "terminal"));
}

// Settings → Accounts → CLIs: whether each CLI is logged in, with a Log in button when it isn't.
export default function CliLogins({ titleClass }: { titleClass: string }) {
  const [login, setLogin] = useState<LoginStatus>({ kind: "loading" });
  const [starting, setStarting] = useState<Backend | null>(null);
  const [startError, setStartError] = useState<Partial<Record<Backend, string>>>({});

  // Only sets state once the request settles, so it's safe to call from an effect.
  const fetchLoginStatus = useCallback(
    () =>
      api.loginStatus().then(
        (r) => setLogin({ kind: "ready", status: r.status, runs: r.runs }),
        (err: unknown) => setLogin({ kind: "error", error: message(err) }),
      ),
    [],
  );

  // The panel re-reads the logins on a timer, so a login finished in the browser shows up here
  // without anyone pressing Refresh. GitHub issue #13: the panel used to read the status once and
  // then keep saying "Not logged in" after a successful login.
  useEffect(() => {
    void fetchLoginStatus();
    const timer = setInterval(() => void fetchLoginStatus(), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchLoginStatus]);

  function refreshLoginStatus() {
    setStartError({});
    void fetchLoginStatus();
  }

  async function startLogin(backend: Backend) {
    setStarting(backend);
    setStartError((e) => ({ ...e, [backend]: undefined }));
    try {
      await api.login(backend, "start");
      // Look again straight away: the CLI may already be logged in.
      void fetchLoginStatus();
    } catch (err) {
      setStartError((e) => ({ ...e, [backend]: message(err) }));
    } finally {
      setStarting(null);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h3 className={titleClass}>CLIs</h3>
        <button
          onClick={refreshLoginStatus}
          disabled={login.kind === "loading"}
          className="flex items-center gap-1 text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline"
        >
          <Icon name="reload" size={12} />
          Refresh
        </button>
      </div>

      {login.kind === "loading" ? (
        <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted">
          <Spinner size={12} /> Checking logins
        </div>
      ) : login.kind === "error" ? (
        <p className="break-words text-[12.5px] text-danger">Couldn&apos;t check logins: {login.error}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {CLIS.map((cli) => {
            // A CLI the server didn't report on reads as Unknown.
            const s = (login.status as Partial<Record<Backend, CliStatus>>)[cli.id];
            const line = statusLine(s);
            const error = startError[cli.id];
            // A login the server is running for this CLI: the button waits for it.
            const running = liveRun(login.runs, cli.id);
            return (
              <div key={cli.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
                <span className="w-[96px] shrink-0 text-[13px] font-medium text-ink">{cli.label}</span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${line.dot}`} aria-hidden="true" />
                  <span className={`min-w-0 break-words text-[12.5px] ${s?.error ? "text-danger" : "text-muted"}`}>
                    {line.text}
                    {error && <span className="block text-danger">{error}</span>}
                  </span>
                </span>
                {running ? (
                  <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-ok">
                    <Spinner size={11} /> Logging in
                  </span>
                ) : (
                  s &&
                  !s.loggedIn && (
                    <button
                      onClick={() => void startLogin(cli.id)}
                      disabled={starting !== null}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
                    >
                      {starting === cli.id && <Spinner size={11} />}
                      Log in
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
