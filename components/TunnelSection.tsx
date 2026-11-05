"use client";

import { useState } from "react";
import { useTunnels } from "@/lib/use-tunnels";

const DEFAULT_TARGET = "http://localhost:3000";

// One project's tunnels, at the top of its 🪝 section (docs/architecture/tunnels.md): a private address for a dev
// server, opened with Touch ID, with Copy and Close on each. The form stays folded behind Open a tunnel, because a
// project with no tunnel shouldn't lose a row of the drawer to it.
export default function TunnelSection({ folder, notify }: { folder: string; notify: (err: unknown) => void }) {
  const { tunnels, open, close } = useTunnels([folder]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  }

  const copy = (address: string) => navigator.clipboard.writeText(address).then(() => notify("Copied the tunnel's address"), notify);
  const button = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-50";

  return (
    <div className="px-1.5 pb-1">
      {tunnels.map((t) => (
        <div key={t.id} className="flex items-center gap-1 py-0.5 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-ink" title={t.address}>
            {t.name} · until {new Date(t.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button className={button} onClick={() => void copy(t.address)}>
            Copy
          </button>
          <button className={button} disabled={busy} onClick={() => void run(() => close(t.id))}>
            Close
          </button>
        </div>
      ))}
      {target === null ? (
        <button className={button} onClick={() => setTarget(DEFAULT_TARGET)}>
          Open a tunnel
        </button>
      ) : (
        <form
          className="flex items-center gap-1 py-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await open(folder, target);
              setTarget(null);
            });
          }}
        >
          <input aria-label="Dev server address" value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink" />
          <button type="submit" className={button} disabled={busy}>
            {busy ? "Opening…" : "Open"}
          </button>
          <button type="button" className={button} onClick={() => setTarget(null)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
