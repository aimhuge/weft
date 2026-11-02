"use client";

// Settings → Devices → a paired worker's Re-pair (docs/architecture/project-hosts.md#re-pairing-a-worker): the box
// trusts this Mac, so it moves to another Mac only on this Mac's signature. Paste the new Mac's wph.… code, Touch ID,
// and main (electron/worker-repair.cjs) signs and hands back the line to run on the box. The key stays in main.
import { useState } from "react";
import type { DeviceView } from "@/lib/device-registry";
import { hostPairingBridge, type RepairResult } from "@/lib/use-devices";

const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

export function WorkerRepair({ device, onClose }: { device: Pick<DeviceView, "id" | "name">; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await hostPairingBridge()?.approveRepair?.(device.id, code);
      if (r) setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (result && !("denied" in result))
    return (
      <div className="mt-2 flex w-full flex-col gap-2">
        <p className="text-[12.5px] text-ink">
          Approved for the Mac {result.fingerprint}. Run this in a terminal on {device.name} within 30 minutes:
        </p>
        <code className="block select-all break-all rounded-md bg-sunken px-2 py-1 font-mono text-[12px] text-ink">{result.command}</code>
        <div className="flex gap-2">
          <button type="button" className={BUTTON} onClick={() => void navigator.clipboard.writeText(result.command)}>
            Copy
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  return (
    <div className="mt-2 flex w-full flex-col gap-2">
      <p className="text-[12.5px] text-ink">
        Paste the wph.… code from the Mac {device.name} should trust next (its Settings → Devices → Add a worker). Touch ID here approves the move.
      </p>
      <input
        aria-label={`New pairing code for ${device.name}`}
        className="rounded-md border border-line-strong bg-transparent px-2 py-1 font-mono text-[12px] text-ink"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="wph.…"
        spellCheck={false}
      />
      {result && "denied" in result && <p className="text-[12.5px] text-muted">Not approved.</p>}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={BUTTON} disabled={busy || !code.trim()} onClick={() => void approve()}>
          Approve
        </button>
        <button type="button" className={BUTTON} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
