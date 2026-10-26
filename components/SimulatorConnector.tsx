"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/client";
import type { InstallJob, InstallKey, SimulatorCheck, SimulatorStatus } from "@/lib/simulator-view";
import { useConnectorStatus } from "@/lib/use-connector-status";
import { Spinner } from "./Icon";

type Jobs = Partial<Record<InstallKey, InstallJob>>;

const BUTTON = "shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-ink hover:bg-sunken";
const INSTALL_URL = "/api/connectors/simulators/install";
const POLL_MS = 1500;

const runningKeys = (jobs: Jobs) => Object.keys(jobs).filter((k) => jobs[k as InstallKey]?.status === "running");

// A row's fix: Install (Weft runs it), Open (a download page), or just where to click. Rows that share an Install
// with a row above say so instead of offering it twice.
function Fix({ check, job, first, onInstall }: { check: SimulatorCheck; job?: InstallJob; first: boolean; onInstall: (key: InstallKey) => void }) {
  const fix = check.fix;
  if (!fix) return null;
  const { install, url } = fix;
  if (install && !first) return <div className="mt-1 text-[12px] text-muted">Comes with the Install above</div>;
  const running = job?.status === "running";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
      {running ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Spinner size={11} />
          <span className="truncate" title={job.line}>
            {job.line}
          </span>
        </span>
      ) : (
        <span>{fix.text}</span>
      )}
      {install && !running && (
        <button className={BUTTON} title={fix.command} onClick={() => onInstall(install)}>
          {job?.status === "failed" ? "Try again" : "Install"}
        </button>
      )}
      {url && (
        <button className={BUTTON} onClick={() => window.weft?.openExternal(url)}>
          Open
        </button>
      )}
      {job?.status === "failed" && <span className="w-full text-danger">{job.line}</span>}
    </div>
  );
}

function Row({ check, ...fix }: { check: SimulatorCheck; job?: InstallJob; first: boolean; onInstall: (key: InstallKey) => void }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${check.ok ? "bg-ok" : "bg-line-strong"}`} aria-hidden="true" />
        <span className="shrink-0 text-[13px] text-ink">{check.label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-faint" title={check.detail}>
          {check.detail}
        </span>
      </div>
      <Fix check={check} {...fix} />
    </div>
  );
}

// Settings → Connectors → Simulators: what the threads' mcp__simulator__* tools have on this Mac, and the fix for
// each missing piece. Install runs it on the server (lib/simulator-install.ts); the panel polls its last line of
// output and looks again when it ends.
export default function SimulatorConnector({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const { load, refresh, reload } = useConnectorStatus<SimulatorStatus>({
    load: () => call<SimulatorStatus>("GET", "/api/connectors/simulators"),
  });

  const [jobs, setJobs] = useState<Jobs>({});
  const jobsRef = useRef<Jobs>({});
  const takeJobs = useCallback(
    (next: Jobs) => {
      // An install that just ended changed what's on this Mac: look again.
      const ended = runningKeys(jobsRef.current).some((k) => next[k as InstallKey]?.status !== "running");
      jobsRef.current = next;
      setJobs(next);
      if (ended) void reload();
    },
    [reload],
  );
  const busy = runningKeys(jobs).length > 0;

  // Picks up an install still running from before Settings was reopened, then follows it while it runs.
  useEffect(() => {
    void call<Jobs>("GET", INSTALL_URL).then(takeJobs, () => {});
  }, [takeJobs]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void call<Jobs>("GET", INSTALL_URL).then(takeJobs, () => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, takeJobs]);

  function install(key: InstallKey) {
    const set = (job: InstallJob) => takeJobs({ ...jobsRef.current, [key]: job });
    void call<InstallJob>("POST", INSTALL_URL, { key }).then(set, (err: unknown) => set({ status: "failed", line: err instanceof Error ? err.message : String(err) }));
  }

  // The rows under one platform, each with the fix for it.
  const section = (status: SimulatorStatus, platform: SimulatorCheck["platform"], title: string) => {
    const offered = new Set<InstallKey>();
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium uppercase tracking-wide text-faint">{title}</div>
        {status.checks
          .filter((c) => c.platform === platform)
          .map((c) => {
            const key = c.fix?.install;
            const first = !key || !offered.has(key);
            if (key) offered.add(key);
            return <Row key={c.key} check={c} job={key && jobs[key]} first={first} onInstall={install} />;
          })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className={titleClass}>📱 Simulators</div>
          <p className={hintClass}>
            Threads drive iOS simulators and Android emulators: boot, install, tap, type, screenshot, and watch them live in the browser pane.
            {load.kind === "ready" && ` ${load.status.devices} device${load.status.devices === 1 ? "" : "s"} found.`}
          </p>
        </div>
        <button className={BUTTON} onClick={refresh} disabled={load.kind === "loading"}>
          Check again
        </button>
      </div>
      {load.kind === "loading" && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner size={12} /> Looking for Xcode and the Android SDK…
        </div>
      )}
      {load.kind === "error" && <p className="text-[12.5px] text-danger">{load.error}</p>}
      {load.kind === "ready" && (
        <>
          {section(load.status, "ios", "iOS")}
          {section(load.status, "android", "Android")}
        </>
      )}
    </div>
  );
}
