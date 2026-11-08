"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/client-api";

// Settings → Security → Database changes (lib/db-calls.ts): let a destructive-SQL prompt through without asking when
// the second model's review says Safe and the static scan agrees. Off until you turn it on; a "Deletes data",
// "Changes access" or "Can't tell" verdict always waits for you.

export function SqlAutoAcceptSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    call<{ autoAccept: boolean }>("GET", "/api/sql-review").then(
      (r) => live && setOn(r.autoAccept),
      () => live && setOn(false),
    );
    return () => {
      live = false;
    };
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    call("PUT", "/api/sql-review", { autoAccept: next }).catch(() => setOn(!next));
  };
  return (
    <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11.5px] text-muted">
      <input type="checkbox" checked={on ?? false} disabled={on === null} onChange={toggle} className="accent-accent" />
      Accept harmless SQL without asking: the review says Safe and nothing deletes data. The thread notes each one.
    </label>
  );
}
