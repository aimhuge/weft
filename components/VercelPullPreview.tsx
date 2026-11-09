"use client";

import { useEffect } from "react";
import type { PullPlan } from "@/lib/vercel-drift";
import { ENV_SHORT } from "@/lib/vercel-view";

const BUTTON = "rounded border border-line px-1.5 text-[10px] leading-[16px] text-faint hover:text-ink disabled:opacity-40";

// Pull's confirm (components/VercelDriftActions.tsx): by environment, the names that will come down from Vercel and the
// sensitive ones it never hands back, so those are added by hand. Names only; Pull N asks one Touch ID in main.
export default function VercelPullPreview({ plan, onPull, onClose }: { plan: PullPlan[]; onPull: () => void; onClose: () => void }) {
  const n = plan.reduce((sum, p) => sum + p.pull.length, 0);
  const sensitive = plan.filter((p) => p.sensitive.length);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div role="dialog" aria-label="Pull from Vercel" className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md border border-line bg-panel p-2 text-[11px] text-muted shadow-lg">
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {n > 0 ? (
          plan
            .filter((p) => p.pull.length)
            .map((p) => (
              <p key={p.environment}>
                <span className="text-ink">{ENV_SHORT[p.environment]}</span> · {p.pull.join(", ")}
              </p>
            ))
        ) : (
          <p className="text-ink">Nothing Vercel will hand back.</p>
        )}
        {sensitive.length > 0 && (
          <div className="border-t border-line pt-1.5">
            <p>Sensitive on Vercel, so its API never returns the value. Add these by hand:</p>
            {sensitive.map((p) => (
              <p key={p.environment} className="text-faint">
                {ENV_SHORT[p.environment]} · {p.sensitive.join(", ")}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <button onClick={onClose} className={BUTTON}>
          Cancel
        </button>
        {n > 0 && (
          <button onClick={onPull} className={`${BUTTON} text-ink`} title="One Touch ID, then the values go straight from Vercel into the vault">
            Pull {n}
          </button>
        )}
      </div>
    </div>
  );
}
