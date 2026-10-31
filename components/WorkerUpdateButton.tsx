"use client";

// "Update now" on a worker of yours in Settings → Sync → Workers (docs/architecture/weft-worker.md#auto-updates). It
// asks for the check the worker runs by itself, so it can't cut a turn off: a live card still holds the update, and
// the row names it. A box that's already current says nothing new, so the button says it asked.

import { useState } from "react";
import { Spinner } from "./Icon";

const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

export default function WorkerUpdateButton({ offline, send }: { offline: boolean; send: () => Promise<unknown> }) {
  const [state, setState] = useState<{ busy?: boolean; asked?: boolean; error?: string }>({});

  async function onClick() {
    setState({ busy: true });
    try {
      await send();
      setState({ asked: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <>
      {state.asked && <span className={SUBTLE}>Checking</span>}
      {state.error && <span className="text-[12.5px] text-danger">{state.error}</span>}
      <button type="button" onClick={() => void onClick()} disabled={offline || state.busy} className={BUTTON}>
        {state.busy && <Spinner size={11} />}
        Update now
      </button>
    </>
  );
}
