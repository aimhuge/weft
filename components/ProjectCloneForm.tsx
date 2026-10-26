"use client";

// The project menu's "Clone from GitHub" form: owner/name or a github.com URL, cloned into ~/dev as a new project,
// with the clone's progress bar under it while it runs (components/CloneProgress.tsx).
import { useState } from "react";
import { api } from "@/lib/client";
import CloneProgress from "./CloneProgress";
import { FIELD, SUBMIT } from "./project-menu-styles";

export default function ProjectCloneForm({
  value,
  onChange,
  busy,
  onError,
  run,
}: {
  value: string;
  onChange: (next: string) => void;
  busy: boolean;
  onError: (message: string) => void;
  // The menu's runner: selects the folder the action returns, shows its error.
  run: (action: () => Promise<string | null>) => Promise<void>;
}) {
  // The owner/name being cloned, so its progress bar shows under the form.
  const [cloning, setCloning] = useState<string | null>(null);

  function submit(e: React.SubmitEvent) {
    e.preventDefault();
    const slug = value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
      onError("Use owner/name, like aimhuge/weft.");
      return;
    }
    setCloning(slug);
    void run(async () => (await api.cloneRepo(slug)).path).finally(() => setCloning(null));
  }

  return (
    <>
      <form onSubmit={submit} className="flex gap-1.5 px-2.5 pb-2 pt-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="owner/name or github.com URL"
          aria-label="GitHub repo"
          className={`${FIELD} font-mono`}
        />
        <button type="submit" disabled={busy} className={SUBMIT}>
          {busy ? "Cloning…" : "Clone"}
        </button>
      </form>
      {cloning && (
        <div className="px-2.5 pb-2">
          <CloneProgress fullName={cloning} />
        </div>
      )}
    </>
  );
}
