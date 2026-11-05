"use client";

// The Phones card on Settings → Sync: the phones signed in to your Weft account, which buzz when a synced card
// needs you or is ready for review (docs/architecture/mobile.md#push), each with a Remove. Phones pair themselves:
// signing in on the Weft phone app registers it, so there's nothing to add from here.

import { useState } from "react";
import { timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePushDevices } from "@/lib/use-push-devices";
import type { PushDevice } from "@/lib/push-devices";
import { Spinner } from "./Icon";

const CARD = "rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint";
const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

const label = (d: PushDevice) => d.deviceName || (d.platform === "ios" ? "iPhone" : "Android phone");

export default function PhoneSettings() {
  const { view, error, remove } = usePushDevices();
  const now = useNow();
  const [removing, setRemoving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function onRemove(id: string) {
    setRemoving(id);
    setFailed(null);
    try {
      await remove(id);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(null);
    }
  }

  const devices = view?.devices ?? [];
  return (
    <section data-settings-card className={CARD} onMouseDown={(e) => e.stopPropagation()}>
      <h4 className={SECTION_TITLE}>Phones</h4>
      {!view && !error ? (
        <p className={`flex items-center gap-2 ${SUBTLE}`}>
          <Spinner size={11} /> Loading
        </p>
      ) : view && !view.signedIn ? (
        <p className={SUBTLE}>Sign in to Weft to see the phones that get your pushes.</p>
      ) : devices.length === 0 && view ? (
        <p className={SUBTLE}>
          No phones yet. Sign in on the Weft phone app and it shows up here; it buzzes when a synced card needs you or is ready for review.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink">{label(d)}</div>
                <div className={SUBTLE}>
                  {d.platform === "ios" ? "iOS" : "Android"} · seen {timeAgo(Date.parse(d.lastSeenAt), now)}
                </div>
              </div>
              <button type="button" onClick={() => void onRemove(d.id)} disabled={removing === d.id} className={`flex items-center gap-1.5 ${BUTTON}`}>
                {removing === d.id && <Spinner size={11} />}
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-[12.5px] text-danger">Couldn&apos;t read your phones: {error}</p>}
      {failed && <p className="mt-3 text-[12.5px] text-danger">{failed}</p>}
    </section>
  );
}
