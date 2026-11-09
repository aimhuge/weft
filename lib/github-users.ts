// GitHub people for the share pickers (docs/architecture/sharing.md#people): search by login for the composer's @ and
// the Share dialog's People field, and a login's numeric id for a grant. Through the gh CLI, signed in as you, so search
// gets GitHub's authenticated limit (30 a minute, 10 anonymously); no shell, the login checked first.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { globalSingleton } from "./global-singleton";
import { repoCollaborators } from "./github-collaborators";
import { repoOf } from "./github-issues";
import { githubAccount } from "./github-status";
import { isGithubLogin, type PersonHit } from "./share-grant-types";

export type Gh = (args: string[]) => Promise<string>;

const exec = promisify(execFile);
const realGh: Gh = async (args) => (await exec("gh", args, { timeout: 10_000, maxBuffer: 1024 * 1024 })).stdout;

export const SEARCH_TTL = 5 * 60_000;
export const SEARCH_LIMIT = 8;
const searches = () => globalSingleton("__weftGithubUserSearch", () => new Map<string, { at: number; hits: PersonHit[] }>());

export function clearGithubUserSearch() {
  searches().clear();
  suggestions().clear();
}

// Up to SEARCH_LIMIT accounts whose login starts with or contains `query`, best match first. Kept for SEARCH_TTL, since
// the @ picker asks again on every keystroke after its debounce. An empty or impossible query asks nothing.
export async function searchGithubUsers(query: string, gh: Gh = realGh, now = Date.now()): Promise<PersonHit[]> {
  const q = query.trim().replace(/^@/, "");
  if (!isGithubLogin(q)) return [];
  const key = q.toLowerCase();
  const hit = searches().get(key);
  if (hit && now - hit.at < SEARCH_TTL) return hit.hits;
  let hits: PersonHit[] = [];
  try {
    const out = await gh(["api", "-X", "GET", "search/users", "-f", `q=${q} in:login type:user`, "-f", `per_page=${SEARCH_LIMIT}`, "--jq", ".items[] | [.login, .avatar_url] | @tsv"]);
    hits = out
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(([login]) => isGithubLogin(login))
      .map(([login, avatar]) => ({ login: login as string, name: null, avatarUrl: avatar || null, kind: "github" as const }));
    // GitHub ranks by its own score; an exact login always goes first.
    hits.sort((a, b) => Number(b.login.toLowerCase() === key) - Number(a.login.toLowerCase() === key));
  } catch {
    hits = []; // gh missing, signed out, or rate-limited: the picker shows the team alone
  }
  searches().set(key, { at: now, hits });
  return hits;
}

// The account a login names now: its numeric id (what a grant keys on) and its login as GitHub spells it.
export async function githubUserByLogin(login: string, gh: Gh = realGh): Promise<{ id: number; login: string } | null> {
  const name = login.trim().replace(/^@/, "");
  if (!isGithubLogin(name)) return null;
  try {
    const [id, actual, type] = (await gh(["api", `users/${name}`, "--jq", "[.id, .login, .type] | @tsv"])).trim().split("\t");
    const n = Number(id);
    // An organization can't sign in, so it can't be granted.
    return Number.isSafeInteger(n) && n > 0 && isGithubLogin(actual) && type === "User" ? { id: n, login: actual } : null;
  } catch {
    return null; // no such account, or gh can't ask
  }
}

export type Collaborators = (folder: string) => Promise<{ login: string; avatarUrl: string }[]>;

const realCollaborators: Collaborators = async (folder) => repoCollaborators(await repoOf(folder));
const suggestions = () => globalSingleton("__weftGithubSuggest", () => new Map<string, { at: number; hits: PersonHit[] }>());

// Who the People field opens on before you type: the collaborators of the card's repo, the people most likely to care.
// Kept for SEARCH_TTL per folder; a folder with no GitHub repo (or no gh) suggests no one.
export async function suggestPeople(folder: string, collaborators: Collaborators = realCollaborators, now = Date.now()): Promise<PersonHit[]> {
  const hit = suggestions().get(folder);
  if (hit && now - hit.at < SEARCH_TTL) return hit.hits;
  let hits: PersonHit[] = [];
  try {
    const me = (await githubAccount()).account?.login.toLowerCase();
    hits = (await collaborators(folder))
      .filter((p) => isGithubLogin(p.login) && p.login.toLowerCase() !== me)
      .map((p) => ({ login: p.login, name: null, avatarUrl: p.avatarUrl || null, kind: "repo" as const }));
  } catch {
    hits = [];
  }
  suggestions().set(folder, { at: now, hits });
  return hits;
}
