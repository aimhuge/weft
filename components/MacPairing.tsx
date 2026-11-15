"use client";
// Settings → Devices, on another Mac's row: "Share work…" pairs two of your Macs so one can pull the other's uncommitted
// work (docs/architecture/wip-sync.md#mac-to-mac). Copy THIS Mac's code and paste it in Weft on the other Mac (so this Mac
// can pull from it); paste THAT Mac's code here (so it can pull from this one). Main pins a pasted code after Touch ID
// (electron/mac-pair.cjs). Desktop only: in a browser tab there's no bridge, so it draws nothing.
import { useCallback, useEffect, useState } from "react";

type PairedMac = { id: string; name: string; pairedAt: string };
type MacPairBridge = {
  code(): Promise<string>;
  trust(code: string): Promise<{ id: string; name: string } | null>;
  list(): Promise<PairedMac[]>;
  forget(id: string): Promise<boolean>;
};

const bridge = (): MacPairBridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { weft?: { macPair?: MacPairBridge } }).weft?.macPair;

const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

const said = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));

// `id` is the other Mac's device id (its registry host); `name` is how the row calls it.
export function ShareWork({ id, name }: { id: string | null; name: string }) {
  const [macs, setMacs] = useState<PairedMac[]>([]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pair = bridge();
  const reload = useCallback(() => {
    void bridge()?.list().then(setMacs, () => {});
  }, []);
  useEffect(reload, [reload]);
  if (!pair) return null;

  const pinned = id ? macs.find((m) => m.id === id) : undefined;
  const copy = async () => {
    await navigator.clipboard.writeText(await pair.code());
    setNote("Copied.");
  };
  const trust = async () => {
    setBusy(true);
    try {
      if (await pair.trust(code)) {
        setCode("");
        setNote(null);
        reload();
      }
    } catch (err) {
      setNote(said(err));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (pinned) await pair.forget(pinned.id);
    reload();
  };

  return (
    <div className="mt-1 flex w-full flex-col gap-1.5">
      {pinned && (
        <div className={SUBTLE}>
          {name} can pull this Mac&apos;s work ·{" "}
          <button type="button" className="text-ink underline-offset-2 hover:underline" onClick={() => void stop()} aria-label={`Stop ${name} pulling this Mac's work`}>
            Stop
          </button>
        </div>
      )}
      <div>
        <button type="button" className={BUTTON} aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Share work with ${name}`}>
          Share work…
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="flex flex-col gap-1">
            <div>
              <button type="button" className={BUTTON} onClick={() => void copy().catch((err: unknown) => setNote(said(err)))}>
                Copy code for {name}
              </button>
            </div>
            <p className={SUBTLE}>Paste it in Weft on {name} so this Mac can pull {name}&apos;s uncommitted work.</p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                aria-label={`${name}'s code`}
                placeholder={`Paste ${name}'s code`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-transparent px-2 py-1 font-mono text-[12px] text-ink"
              />
              <button type="button" className={BUTTON} disabled={!code.trim() || busy} onClick={() => void trust()}>
                Allow
              </button>
            </div>
            <p className={SUBTLE}>Paste {name}&apos;s code so {name} can pull this Mac&apos;s uncommitted work.</p>
          </div>
          {note && <p className="text-[12.5px] text-ink">{note}</p>}
        </div>
      )}
    </div>
  );
}
