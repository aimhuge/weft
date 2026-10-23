"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import Icon, { Spinner } from "./Icon";
import { track } from "@/lib/analytics";

// The folder picker's "New project…": names an empty folder in ~/dev, creates it and hands back its path.

// A folder name the new-project route accepts.
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isProjectName(name: string) {
  return PROJECT_NAME.test(name);
}

export default function NewProjectForm({
  parent,
  shownParent,
  initialName,
  onCreated,
  onBack,
}: {
  parent: string;
  shownParent: string;
  initialName: string;
  onCreated: (path: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function create() {
    if (!isProjectName(trimmed)) {
      setError(trimmed ? "Use letters, numbers, dots, dashes, and underscores for the name." : "Name the project first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated((await api.newProject(parent, trimmed)).path);
      track("project_created");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Back to the list, not out of the picker.
      e.stopPropagation();
      onBack();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!busy) void create();
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-1.5">
        <div className="flex items-center rounded-md bg-canvas pl-2.5 pr-1">
          <span className="shrink-0 font-mono text-[12px] text-faint">{shownParent}/</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              // Spaces become dashes, so "my app" names the folder my-app.
              setName(e.target.value.replace(/\s+/g, "-"));
              setError(null);
            }}
            placeholder="new-project"
            aria-label="New project name"
            className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded bg-accent px-2 py-1 text-[11.5px] font-medium text-white disabled:opacity-70"
          >
            {busy ? <Spinner size={10} /> : <Icon name="plus" size={11} />} Create
          </button>
        </div>
      </div>
      <p className="px-3.5 py-3 text-[12px] leading-relaxed text-muted">
        Makes an empty folder at{" "}
        <span className="font-mono text-ink">
          {shownParent}/{trimmed || "…"}
        </span>{" "}
        and starts the thread there, ready to scaffold.
      </p>
      <div className="mt-auto shrink-0 border-t border-line p-1">
        <button
          type="button"
          onClick={onBack}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-sunken"
        >
          <Icon name="chevronLeft" size={13} /> Back to projects
        </button>
        {error && <p className="px-2.5 pb-1.5 pt-1 text-[12px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
