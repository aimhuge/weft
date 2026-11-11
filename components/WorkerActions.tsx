"use client";

// A worker's row in Settings → Devices (docs/architecture/weft-worker.md#forget-a-worker): one Forget, and a line
// under the row saying what it does. Re-pin, Re-pair and Revoke are folded into it: forget the box, pair it again (with
// this Mac or another), and its threads come along.
import type { DeviceView } from "@/lib/device-registry";

const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

// The lines to run on the box after a Forget (lib/worker-forget.ts).
export const BOX_STEPS = "weft-worker forget\nweft-worker enrol wph.…\nweft-worker restart";

// What Forget does, said on the row.
export const forgetLine = (name: string) => `Forget: ${name} stops trusting this Mac; pair it again to use it.`;

export function ForgetButton({ d, onForget }: { d: DeviceView; onForget: () => void }) {
  return (
    <button type="button" className={BUTTON} onClick={onForget} aria-label={`Forget ${d.name}`}>
      Forget
    </button>
  );
}

// Forget's confirm: what happens, and what to run on the box afterwards.
export function ForgetConfirm({ d, onForget, onClose }: { d: DeviceView; onForget: () => void; onClose: () => void }) {
  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md border border-line p-3 text-[12.5px] text-ink" role="group" aria-label={`Forget ${d.name}?`}>
      <p>
        {d.name}&apos;s key stops working now, so it takes no threads, secrets or settings from your account. Its threads stay, and come back when you pair it again: run these on {d.name}, with the code from Add a worker.
      </p>
      <code className="block select-all whitespace-pre rounded-md bg-sunken px-2 py-1 font-mono text-[12px]">{BOX_STEPS}</code>
      <div className="flex gap-2">
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            onForget();
            onClose();
          }}
        >
          Forget now
        </button>
        <button type="button" className={BUTTON} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
