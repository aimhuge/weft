"use client";
// Settings → Devices → "Your other Macs": pairing two of your Macs so one can pull the other's uncommitted work
// (docs/architecture/wip-sync.md#mac-to-mac). Copy this Mac's code on the Mac that will ask, paste it on the one that
// will answer; main pins it after Touch ID (electron/mac-pair.cjs). Desktop only: in a browser tab there's no bridge,
// so it draws nothing.
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

export function MacPairing() {
  const [macs, setMacs] = useState<PairedMac[]>([]);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pair = bridge();
  const reload = useCallback(() => {
    void bridge()?.list().then(setMacs, () => {});
  }, []);
  useEffect(reload, [reload]);
  if (!pair) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(await pair.code());
    setNote("Copied this Mac's code. Paste it here on your other Mac.");
  };
  const trust = async () => {
    setBusy(true);
    try {
      const mac = await pair.trust(code);
      if (mac) {
        setCode("");
        setNote(`${mac.name} can now ask this Mac for its uncommitted work.`);
        reload();
      }
    } catch (err) {
      setNote(said(err));
    } finally {
      setBusy(false);
    }
  };
  const forget = async (mac: PairedMac) => {
    await pair.forget(mac.id);
    setNote(`${mac.name} can no longer ask this Mac for its work.`);
    reload();
  };

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      <div className="text-[13px] text-ink">Your other Macs</div>
      <p className={SUBTLE}>
        To pull this Mac&apos;s uncommitted work from another Mac, copy that Mac&apos;s code and paste it here. This Mac then answers its requests,
        each one approved with Touch ID over there. Nothing else is trusted.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => void copy().catch((err: unknown) => setNote(said(err)))}>
          Copy This Mac&apos;s Code
        </button>
        <input
          aria-label="Another Mac's code"
          placeholder="Paste another Mac's code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-transparent px-2 py-1 font-mono text-[12px] text-ink"
        />
        <button type="button" className={BUTTON} disabled={!code.trim() || busy} onClick={() => void trust()}>
          Pair
        </button>
      </div>
      {note && <p className="text-[12.5px] text-ink">{note}</p>}
      {macs.length > 0 && (
        <ul className="flex flex-col gap-1">
          {macs.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] text-ink">
                {m.name} <span className={SUBTLE}>· can ask for this Mac&apos;s work</span>
              </span>
              <button type="button" className={BUTTON} onClick={() => void forget(m)} aria-label={`Forget ${m.name}`}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
