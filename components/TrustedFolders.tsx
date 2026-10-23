"use client";

// Settings → Security: the folders outside any project that threads may use without asking. The guard itself
// is lib/folder-guard.ts; "Always" on one of its prompts adds a folder, and this row both shows the list and
// lets you take one back out. The list arrives in the settings view (allowedFolders), so reading it costs no
// request; adding and removing each go back through /api/folders.
//
// The two handlers live in lib/trusted-folders.ts rather than inline here: with them in the component the
// function ran past the 60-line ceiling, and they're plain async-to-state transitions with nothing to render.

import { useState } from "react";
import { addFolder, revokeFolder } from "@/lib/trusted-folders";
import { folderName } from "@/lib/format";
import Icon, { Spinner } from "./Icon";
import { SettingsSectionHeader } from "./SettingsLayout";

const BUTTON = "rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40";

export default function TrustedFolders({ folders }: { folders: string[] }) {
  const [left, setLeft] = useState(folders);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // Drop the row the moment the revoke lands, so the button reads as done even before the server answers.
  function revoke(folder: string) {
    setBusy(folder);
    setError("");
    revokeFolder(folder)
      .then(() => setLeft((f) => f.filter((x) => x !== folder)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  }

  async function add() {
    setAdding(true);
    setError("");
    try {
      const picked = await addFolder();
      if (picked) setLeft((f) => (f.includes(picked) ? f : [...f, picked]));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  const working = adding || busy !== null;

  return (
    <section className="flex flex-col gap-2.5">
      <SettingsSectionHeader
        title="Trusted folders"
        hint="Threads may read these without asking, wherever their project points. Add one here, or choose Always on a thread's folder prompt; take one back out and they ask again. A thread already running keeps what it was given until this card's turn ends."
      />
      <div>
        <button type="button" onClick={() => void add()} disabled={working} className={`flex items-center gap-1.5 ${BUTTON}`}>
          {adding ? <Spinner size={11} /> : <Icon name="plus" size={12} />} Add folder
        </button>
      </div>
      {left.length === 0 ? (
        <p className="text-[12.5px] text-muted">None. A thread reaches outside its project only by asking you first.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {left.map((folder) => (
            <li key={folder} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={folder}>
                {folderName(folder)}
              </span>
              <button
                type="button"
                // Named for the folder, so a screen reader says which trust this button takes back.
                aria-label={`Stop trusting ${folder}`}
                onClick={() => revoke(folder)}
                disabled={working}
                className={`flex shrink-0 items-center gap-1.5 ${BUTTON}`}
              >
                {busy === folder && <Spinner size={11} />}
                <Icon name="x" size={12} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}