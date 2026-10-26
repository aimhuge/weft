"use client";

import { useCallback, useEffect, useState } from "react";
import { call } from "@/lib/client";
import type { SimulatorCheck, SimulatorStatus } from "@/lib/simulator-view";
import { Spinner } from "./Icon";

type Load = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; status: SimulatorStatus };

const BUTTON = "shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-ink hover:bg-sunken";

function Fix({ check }: { check: SimulatorCheck }) {
  const [copied, setCopied] = useState(false);
  const fix = check.fix;
  if (!fix) return null;
  const { command, url } = fix;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
      <span>{fix.text}</span>
      {command && (
        <>
          <code className="rounded bg-sunken px-1.5 py-0.5 text-ink">{command}</code>
          <button className={BUTTON} onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}>
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      )}
      {url && (
        <button className={BUTTON} onClick={() => window.weft?.openExternal(url)}>
          Open
        </button>
      )}
    </div>
  );
}

function Row({ check }: { check: SimulatorCheck }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${check.ok ? "bg-ok" : "bg-line-strong"}`} aria-hidden="true" />
        <span className="shrink-0 text-[13px] text-ink">{check.label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-faint" title={check.detail}>
          {check.detail}
        </span>
      </div>
      <Fix check={check} />
    </div>
  );
}

// Settings → Connectors → Simulators: what the threads' mcp__simulator__* tools have on this Mac, and the command or
// link for each missing piece. Weft never installs these itself; you run the fix, then Check again.
export default function SimulatorConnector({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const fetchStatus = useCallback(
    () =>
      call<SimulatorStatus>("GET", "/api/connectors/simulators").then(
        (status) => setLoad({ kind: "ready", status }),
        (err: unknown) => setLoad({ kind: "error", error: err instanceof Error ? err.message : String(err) }),
      ),
    [],
  );

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // After you've run a fix: look again.
  function refresh() {
    setLoad({ kind: "loading" });
    void fetchStatus();
  }

  const section = (status: SimulatorStatus, platform: SimulatorCheck["platform"], title: string) => (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] font-medium uppercase tracking-wide text-faint">{title}</div>
      {status.checks.filter((c) => c.platform === platform).map((c) => (
        <Row key={c.key} check={c} />
      ))}
    </div>
  );

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
