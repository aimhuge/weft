"use client";

import { useState } from "react";
import { useBuildError } from "@/lib/build-error";
import { useBreakReport } from "@/lib/use-break-report";
import Icon from "./Icon";

// Stands in for Next's Build Error overlay (lib/build-error.ts): the board behind it is the last version that
// compiled and still works, so say which file broke and get out of the way. × hides it until a different error shows.
export default function BuildErrorBar() {
  const error = useBuildError();
  // And tell the server, so the card whose edit did it is marked on the board (lib/crash-blame.ts).
  useBreakReport(error);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = error && `${error.file}\n${error.message}`;
  if (!error || key === dismissed) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-16 left-4 z-50 flex max-w-md flex-col gap-1.5 rounded-lg border border-danger/40 bg-panel px-3.5 py-2.5 text-[12.5px] text-ink shadow-lg"
    >
      <div className="flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-danger" />
        <span className="flex-1">
          Build error{error.file && <> in <span className="font-mono text-[11.5px]">{error.file}</span></>}. You&apos;re on
          the last version that built; it updates once the file is fixed.
        </span>
        <button onClick={() => setOpen(!open)} className="shrink-0 font-medium text-accent hover:underline">
          {open ? "Hide" : "Details"}
        </button>
        <button
          onClick={() => setDismissed(key)}
          aria-label="Dismiss"
          title="Dismiss until a different error"
          className="-mr-1 shrink-0 text-muted hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {open && (
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded bg-sunken p-2 font-mono text-[11px]">
          {error.message}
        </pre>
      )}
    </div>
  );
}
