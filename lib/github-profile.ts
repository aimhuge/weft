import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { globalSingleton } from "./global-singleton";
import type { GithubProfile } from "./welcome-types";

// Your GitHub profile for the Loom's "You" tab, read through the gh CLI you're already signed in to
// (`gh api user`). Kept for hours since it rarely changes; a missing or signed-out gh is remembered
// briefly so the dialog doesn't wait on it every time it opens.

// The profile's shape lives in lib/welcome-types.ts (types only, no node:child_process), so the board
// can name it without dragging this module into the browser chunk. Re-exported here: the server's own
// imports of "./github-profile" keep working.
export type { GithubProfile };

export const PROFILE_TTL = 6 * 60 * 60 * 1000;
export const MISS_TTL = 10 * 60 * 1000;

const run = promisify(execFile);
const cache = () => globalSingleton<{ at: number; profile: GithubProfile | null }>("__weftGithubProfile", () => ({ at: 0, profile: null }));

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// gh's user JSON in the shape the dialog draws, or null when it isn't a user.
export function parseProfile(json: string): GithubProfile | null {
  let raw: Record<string, unknown> | null;
  try {
    raw = JSON.parse(json) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!raw) return null;
  const login = text(raw.login);
  if (!login) return null;
  const blog = text(raw.blog);
  return {
    login,
    name: text(raw.name),
    bio: text(raw.bio),
    avatarUrl: text(raw.avatar_url),
    url: text(raw.html_url) ?? `https://github.com/${login}`,
    company: text(raw.company)?.replace(/^@/, "") ?? null,
    location: text(raw.location),
    blog: blog && !/^https?:\/\//.test(blog) ? `https://${blog}` : blog,
    followers: typeof raw.followers === "number" ? raw.followers : 0,
    publicRepos: typeof raw.public_repos === "number" ? raw.public_repos : 0,
  };
}

// What's cached, without asking GitHub (the header chip's light request).
export function cachedGithubProfile(): GithubProfile | null {
  return cache().profile;
}

export async function githubProfile(now = Date.now()): Promise<GithubProfile | null> {
  const c = cache();
  if (c.at && now - c.at < (c.profile ? PROFILE_TTL : MISS_TTL)) return c.profile;
  let profile: GithubProfile | null = null;
  try {
    const { stdout } = await run("gh", ["api", "user"], { timeout: 10_000 });
    profile = parseProfile(stdout);
  } catch {
    // No gh, not signed in, or offline: keep the last profile we had.
    profile = c.profile;
  }
  c.at = now;
  c.profile = profile;
  return profile;
}
