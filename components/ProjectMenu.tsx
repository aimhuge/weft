// The "More" dropdown menu in the project bar: every project (so the user can pick one outside the
// recent six) under a filter box that has focus when the menu opens (Enter picks the top match), an "Open folder" action, a "Clone from GitHub" form and a "New project" form. The desktop's native folder picker
// bypasses the form; a browser tab falls back to a paste-in path field.
import { useState } from "react";
import { api } from "@/lib/client";
import { openChangelog } from "@/lib/changelog-open";
import { filterProjects, folderName, plural, shortPath } from "@/lib/project-bar";
import type { ProjectSummary } from "@/lib/board-view";
import Icon from "./Icon";
import ReseedButton from "./ReseedButton";
import SearchField from "./SearchField";

const FIELD =
  "w-full min-w-0 rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-faint focus:border-accent";
const MENU_ACTION =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const SUBMIT =
  "shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50";

type Form = "none" | "open" | "new" | "clone";

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function ProjectMenu({
  projects,
  selected,
  onSelect,
  home,
  menuId,
  variant = "desktop",
}: {
  projects: ProjectSummary[];
  selected: string | null;
  onSelect: (path: string | null) => void;
  home: string;
  menuId: string;
  // "desktop" adds the Mac-only actions under the list (open a folder, clone a repo, make a
  // project, read a changelog). "web" is the picker on its own: weft.zip can't reach the Mac's
  // filesystem, so the list and its filter are all there is.
  variant?: "desktop" | "web";
}) {
  const [form, setForm] = useState<Form>("none");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const shown = filterProjects(projects, query, home);

  function choose(path: string | null) {
    onSelect(path);
  }

  function showForm(next: Form) {
    setError(null);
    if (next === form) {
      setForm("none");
      return;
    }
    if (next === "open" || next === "clone") setFolder("");
    if (next === "new") {
      setName("");
      setParent(home ? `${home}/dev` : "~/dev");
    }
    setForm(next);
  }

  // Runs an add/create call and selects the folder it returns (null means the user cancelled).
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const path = await action();
      if (path) choose(path);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // The desktop app has a native folder picker; a browser tab gets a field to paste a path into.
  function openFolder() {
    const bridge = window.weft;
    if (!bridge) {
      showForm("open");
      return;
    }
    setForm("none");
    void run(async () => {
      const picked = await bridge.dialog.openFolder();
      return picked ? (await api.addProject(picked)).path : null;
    });
  }

  function addFolder(e: React.SubmitEvent) {
    e.preventDefault();
    const path = folder.trim();
    if (!path) {
      setError("Paste a folder path first.");
      return;
    }
    void run(async () => (await api.addProject(path)).path);
  }

  // Accepts owner/name or a github.com URL; the clone lands in ~/dev and becomes a project.
  function cloneFromGithub(e: React.SubmitEvent) {
    e.preventDefault();
    const slug = folder.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
      setError("Use owner/name, like aimhuge/weft.");
      return;
    }
    void run(async () => (await api.cloneRepo(slug)).path);
  }

  function createProject(e: React.SubmitEvent) {
    e.preventDefault();
    const projectName = name.trim();
    const parentFolder = parent.trim();
    if (!projectName) {
      setError("Name the project first.");
      return;
    }
    if (!parentFolder) {
      setError("Choose a parent folder.");
      return;
    }
    void run(async () => (await api.newProject(parentFolder, projectName)).path);
  }

  const newPath = name.trim() ? `${shortPath(parent.trim().replace(/\/+$/, ""), home)}/${name.trim()}` : "";

  return (
    <div
      id={menuId}
      className="absolute left-0 top-full z-40 mt-1.5 flex max-h-[min(540px,calc(100vh-110px))] w-[360px] flex-col rounded-lg border border-line bg-panel shadow-lg"
    >
      {projects.length > 0 && (
        <SearchField
          query={query}
          onQuery={setQuery}
          label="Filter projects"
          autoFocus
          onEnter={() => shown[0] && choose(shown[0].path)}
          className="m-1.5 mb-0.5 shrink-0"
        />
      )}
      <div className="min-h-0 overflow-y-auto p-1">
        {projects.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-muted">No projects yet. Open a folder or create one below.</p>
        )}
        {projects.length > 0 && shown.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-muted">No project matches “{query.trim()}”.</p>
        )}
        {shown.map((project) => {
          const on = project.path === selected;
          return (
            <button
              key={project.path}
              onClick={() => choose(project.path)}
              aria-current={on ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left ${on ? "bg-accent-soft" : "hover:bg-sunken"}`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12.5px] ${on ? "text-accent" : "text-ink"}`}>{folderName(project.path)}</span>
                <span className="block truncate font-mono text-[11px] text-muted">{shortPath(project.path, home)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
                {project.needsYou > 0 && (
                  <span className="text-warn">
                    {project.needsYou} {project.needsYou === 1 ? "needs" : "need"} you
                  </span>
                )}
                {project.running > 0 && <span className="text-accent">{project.running} running</span>}
                <span className="text-faint">{plural(project.cards, "card", "cards")}</span>
              </span>
            </button>
          );
        })}
      </div>

      {variant === "desktop" && (
      <div className="shrink-0 border-t border-line p-1">
        {selected && (
          <button onClick={() => { onSelect(selected); openChangelog(selected); }} className={MENU_ACTION}>
            <Icon name="list" size={14} className="text-muted" /> Changelog of {folderName(selected)}
          </button>
        )}
        {selected && <ReseedButton path={selected} className={MENU_ACTION} />}
        <button onClick={openFolder} disabled={busy} className={MENU_ACTION}>
          <Icon name="folder" size={14} className="text-muted" /> Open folder…
        </button>
        {form === "open" && (
          <form onSubmit={addFolder} className="flex gap-1.5 px-2.5 pb-2 pt-1">
            <input
              autoFocus
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setError(null);
              }}
              placeholder="~/dev/my-project"
              aria-label="Folder path"
              className={`${FIELD} font-mono`}
            />
            <button type="submit" disabled={busy} className={SUBMIT}>
              Add
            </button>
          </form>
        )}

        <button onClick={() => showForm("clone")} disabled={busy} className={MENU_ACTION}>
          <Icon name="download" size={14} className="text-muted" /> Clone from GitHub…
        </button>
        {form === "clone" && (
          <form onSubmit={cloneFromGithub} className="flex gap-1.5 px-2.5 pb-2 pt-1">
            <input
              autoFocus
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setError(null);
              }}
              placeholder="owner/name or github.com URL"
              aria-label="GitHub repo"
              className={`${FIELD} font-mono`}
            />
            <button type="submit" disabled={busy} className={SUBMIT}>
              {busy ? "Cloning…" : "Clone"}
            </button>
          </form>
        )}

        <button onClick={() => showForm("new")} disabled={busy} className={MENU_ACTION}>
          <Icon name="plus" size={14} className="text-muted" /> New project…
        </button>
        {form === "new" && (
          <form onSubmit={createProject} className="flex flex-col gap-2 px-2.5 pb-2 pt-1">
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-medium text-muted">Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="my-project"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-medium text-muted">Parent folder</span>
              <input
                value={parent}
                onChange={(e) => {
                  setParent(e.target.value);
                  setError(null);
                }}
                placeholder="~/dev"
                className={`${FIELD} font-mono`}
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={newPath}>
                {newPath}
              </span>
              <button type="submit" disabled={busy} className={SUBMIT}>
                Create
              </button>
            </div>
          </form>
        )}

        {error && <p className="px-2.5 pb-2 pt-1 text-[12px] text-danger">{error}</p>}
      </div>
      )}
    </div>
  );
}
