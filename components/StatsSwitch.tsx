"use client";

import { useEffect, useState } from "react";
import { telemetrySwitch } from "@/lib/telemetry-client";

// The switch for anonymous setup stats (lib/telemetry.ts): in Settings → Security.
// On by default; what's sent is listed in lib/telemetry-events.ts, never prompts, project names, paths or code.

export function StatsSwitch({ className = "" }: { className?: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    telemetrySwitch.get().then(
      (r) => live && setOn(r.on),
      () => live && setOn(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    telemetrySwitch.set(next).catch(() => setOn(!next));
  };
  return (
    <label className={`flex cursor-pointer items-center gap-2 text-[11.5px] text-muted ${className}`}>
      <input type="checkbox" checked={on ?? true} disabled={on === null} onChange={toggle} className="accent-accent" />
      Send anonymous setup stats to help improve Weft. Never prompts, project names or code.
    </label>
  );
}
