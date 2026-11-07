"use client";

// A team's projects (GitHub repos, "owner/name") in Settings → Team, first on the page: the linked list, each with
// how many of this board's cards it has, Remove for those who manage the team, and "Add project" (one owner/name
// field whose typeahead suggests the board's repos and the team's GitHub org's repos not yet linked). Members see
// only the projects they were granted; who sees which is under Advanced (./ProjectAccess). The actions come in as a
// prop like the rest of components/team.
import { useState, useTransition, type SubmitEvent } from "react";
import { REPO_PATTERN, type TeamClientActions, type TeamProject } from "@/lib/team-types";
import { unlinkedRepos } from "@/lib/team-view";

const FIELD = "rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

type Note = { ok: boolean; text: string } | null;

function AddProject({ linked, boardRepos, actions }: { linked: string[]; boardRepos: string[]; actions: TeamClientActions }) {
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [pending, startTransition] = useTransition();
  const choices = unlinkedRepos(boardRepos, linked);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const repo = typed.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    if (!repo) return;
    if (!REPO_PATTERN.test(repo)) {
      setNote({ ok: false, text: "Use the owner/name form, like aimhuge/weft." });
      return;
    }
    startTransition(async () => {
      const result = await actions.addProject(repo);
      setNote({ ok: result.ok, text: result.message ?? (result.ok ? `Added ${repo}.` : "Couldn't add the project.") });
      if (result.ok) {
        setTyped("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2" noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="GitHub repo"
          list="team-project-repos"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={choices.length > 0 ? `${choices[0]}, or any owner/name` : "owner/name, like aimhuge/weft"}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <datalist id="team-project-repos">
          {choices.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <button type="submit" disabled={pending || !typed.trim()} className={BUTTON}>
          {pending ? "Adding…" : "Add project"}
        </button>
      </div>
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`text-[12.5px] ${note.ok ? "text-muted" : "text-danger"}`}>
          {note.text}
        </p>
      ) : null}
    </form>
  );
}

type RowProps = { project: TeamProject; canManage: boolean; actions: TeamClientActions; cards?: number };

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function ProjectRow({ project, canManage, actions, cards }: RowProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Remove ${project.repo} from this team? The repo itself isn't touched. No new Mac can join its 🔐 vault after this, but Macs that already have it keep its keys: to cut someone off, remove them with "Rotate shared vaults" and change the values at the providers.`)) return;
    startTransition(async () => {
      const result = await actions.removeProject(project.repo);
      setError(result.ok ? null : (result.message ?? "Couldn't remove the project."));
    });
  }

  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <a
          href={`https://github.com/${project.repo}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-[13px] text-ink hover:underline"
        >
          {project.repo}
        </a>
        {cards ? <span className="text-[12px] text-muted">{plural(cards, "card")}</span> : null}
        {canManage ? (
          <button type="button" onClick={remove} disabled={pending} className={BUTTON}>
            {pending ? "Removing…" : "Remove"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function Projects({
  projects,
  canManage,
  actions,
  boardRepos,
  cards = {},
}: {
  projects: TeamProject[];
  canManage: boolean;
  actions: TeamClientActions;
  // The repos to suggest: the team's GitHub org's and this board's.
  boardRepos: string[];
  // This board's cards per repo (lib/use-board-repos.ts).
  cards?: Record<string, number>;
}) {
  const repos = projects.map((p) => p.repo);
  return (
    <>
      {projects.length === 0 ? (
        <p className="text-[12.5px] text-muted">{canManage ? "No projects yet. Add a GitHub repo below." : "No projects shared with you yet."}</p>
      ) : (
        <ul className="divide-y divide-line">
          {projects.map((p) => (
            <ProjectRow key={p.repo} project={p} canManage={canManage} actions={actions} cards={cards[p.repo]} />
          ))}
        </ul>
      )}
      {canManage ? <AddProject linked={repos} boardRepos={boardRepos} actions={actions} /> : null}
    </>
  );
}
