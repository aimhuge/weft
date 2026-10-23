"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { trackOnboarding } from "@/lib/telemetry-client";
import type { Backend, CliStatus } from "@/lib/types";
import { Spinner } from "./Icon";
import { WelcomeLoop } from "./WelcomeLoop";

// The welcome's first screen (components/WelcomeDialog.tsx draws the frame and the buttons): what Weft is, as a live
// loop of a card crossing the board with your own project names on it (components/WelcomeLoop.tsx), and whether an agent CLI is ready to run a thread, with Log in right there.

export const CLIS: { id: Backend; label: string; note: string }[] = [
  { id: "claude", label: "Claude Code", note: "Anthropic's coding agent" },
  { id: "puku", label: "puku-cli", note: "Claude Code on the Puku gateway, free to try" },
  { id: "codex", label: "Codex", note: "OpenAI's coding agent" },
];

export type CliStatuses = Partial<Record<Backend, CliStatus>>;

// The CLI a first thread runs on: the first one that's logged in, else Claude Code.
export const readyCli = (status: CliStatuses | null): Backend => CLIS.find((c) => status?.[c.id]?.loggedIn)?.id ?? "claude";

// Each CLI's login, polled every few seconds while the screen shows so a login finished in the browser ticks itself.
export function useCliStatus(poll = true) {
  const [status, setStatus] = useState<CliStatuses | null>(null);
  const refresh = useCallback(
    () =>
      api.loginStatus().then(
        (r) => setStatus(r.status),
        () => setStatus((s) => s ?? {}),
      ),
    [],
  );
  useEffect(() => {
    void refresh();
    if (!poll) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [poll, refresh]);
  return status;
}

// One CLI's readiness: the dot's color, the line beside the label, and whether a Log in button belongs there.
// Pulled out of CliRow so the row itself only draws; this is where the three-way branch lives.
function cliState(cli: (typeof CLIS)[number], status: CliStatus | undefined) {
  const missing = status?.error && /not (found|installed)|ENOENT/i.test(status.error);
  const dot = !status ? "bg-faint" : status.loggedIn ? "bg-ok" : missing ? "bg-line-strong" : "bg-warn";
  const line = !status ? "Checking…" : status.loggedIn ? (status.email ? `Ready · ${status.email}` : "Ready") : missing ? "Not installed" : "Not logged in";
  return { dot, line: status?.loggedIn ? line : `${line} · ${cli.note}`, canLogIn: Boolean(status && !status.loggedIn && !missing) };
}

function CliRow({ cli, status, onLogin, starting }: { cli: (typeof CLIS)[number]; status: CliStatus | undefined; onLogin: () => void; starting: boolean }) {
  const { dot, line, canLogIn } = cliState(cli, status);
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line px-3 py-1.5 text-[12.5px]">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="w-[92px] shrink-0 font-medium text-ink">{cli.label}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{line}</span>
      {canLogIn && (
        <button type="button" onClick={onLogin} disabled={starting} className="flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-ink hover:bg-sunken disabled:opacity-50">
          {starting && <Spinner size={10} />}
          Log in
        </button>
      )}
    </div>
  );
}

// Screen 1: the board in motion in the hero, then the CLIs. One ready CLI is enough; the rest can wait for Settings → Accounts.
export function ReadyStep({ status, projects = [] }: { status: CliStatuses | null; projects?: string[] }) {
  const [starting, setStarting] = useState<Backend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const login = (backend: Backend) => {
    trackOnboarding("onboarding_cli_login", { backend });
    setStarting(backend);
    setError(null);
    api
      .login(backend, "start")
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setStarting(null));
  };
  const ready = CLIS.some((c) => status?.[c.id]?.loggedIn);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[19px] font-semibold text-ink">Welcome to Weft</h2>
        <p className="text-[12.5px] text-muted">Every card is an AI coding thread. You bring the idea; the threads plan it, build it and show it to you.</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <WelcomeLoop projects={projects} />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <b className="text-[13px] text-ink">Your coding agents</b>
          <span className={`text-[11.5px] ${ready ? "text-ok" : "text-warn"}`}>{status === null ? "" : ready ? "✓ Ready to run threads" : "Log in to one to start"}</span>
        </div>
        {CLIS.map((cli) => (
          <CliRow key={cli.id} cli={cli} status={status?.[cli.id]} starting={starting === cli.id} onLogin={() => login(cli.id)} />
        ))}
        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
