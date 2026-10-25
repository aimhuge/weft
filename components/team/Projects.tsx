"use client";

// A team's projects (GitHub repos, "owner/name") in Settings → Team: the linked list with Remove for those who
// manage the team, "Access" to pick which members see each one (./ProjectAccess), and "Add project" (a pick from
// the board's repos not yet linked, or a typed owner/name). Members see only the projects they were granted. The actions come in as a prop like the rest of components/team.
import { useState, useTransition, type SubmitEvent } from "react";
import { REPO_PATTERN, type RoleOption, type TeamClientActions, type TeamMember, type TeamProject } from "@/lib/team-types";
import { unlinkedRepos } from "@/lib/team-view";
import { ProjectAccess } from "./ProjectAccess";
import { ProjectPeople } from "./ProjectPeople";

const FIELD = "rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

type Note = { ok: boolean; text: string } | null;

function AddProject({ linked, boardRepos, actions }: { linked: string[]; boardRepos: string[]; actions: TeamClientActions }) {
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [pending, startTransition] = useTransition();
  const choices = unlinkedRepos(boardRepos, linked);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const repo = (typed.trim() || picked).replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
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
        setPicked("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2" noValidate>
      <div className="flex flex-wrap items-center gap-2">
        {choices.length > 0 ? (
          <select
            aria-label="Project from your board"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className={FIELD}
          >
            <option value="">From your board…</option>
            {choices.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : null}
        <input
          aria-label="GitHub repo"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="owner/name"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="submit" disabled={pending || (!typed.trim() && !picked)} className={BUTTON}>
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

type RowProps = { project: TeamProject; canManage: boolean; actions: TeamClientActions; members: TeamMember[] };

function ProjectRow({ project, canManage, actions, members }: RowProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Remove ${project.repo} from this team? The repo itself isn't touched.`)) return;
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
        {canManage ? <ProjectAccess project={project} members={members} actions={actions} /> : null}
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
  roleOptions,
  members,
  pending,
}: {
  projects: TeamProject[];
  canManage: boolean;
  actions: TeamClientActions;
  boardRepos: string[];
  roleOptions: RoleOption[];
  members: TeamMember[];
  pending: { email: string }[];
}) {
  const repos = projects.map((p) => p.repo);
  return (
    <>
      {projects.length === 0 ? (
        <p className="text-[12.5px] text-muted">{canManage ? "No projects yet. Add a GitHub repo below." : "No projects shared with you yet."}</p>
      ) : (
        <ul className="divide-y divide-line">
          {projects.map((p) => (
            <ProjectRow key={p.repo} project={p} canManage={canManage} actions={actions} members={members} />
          ))}
        </ul>
      )}
      {canManage ? <AddProject linked={repos} boardRepos={boardRepos} actions={actions} /> : null}
      {canManage && repos.length > 0 ? (
        <ProjectPeople repos={repos} members={members} pending={pending} actions={actions} roleOptions={roleOptions} />
      ) : null}
    </>
  );
}
