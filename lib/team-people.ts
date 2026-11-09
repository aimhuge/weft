import type { GithubPerson } from "./github-collaborators";

// The People on your projects list: who to suggest, how many to show.

export const PEOPLE_SHOWN = 5;

// Drop anyone already a member (by GitHub login or email) or invited (by email), case-insensitive. The login matters:
// most people hide their email on GitHub, so a teammate would otherwise be offered an invite they don't need.
export function suggestPeople(
  people: GithubPerson[],
  members: { email: string | null; login?: string | null }[],
  pending: { email: string }[],
): GithubPerson[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set<string>();
  const logins = new Set<string>();
  for (const m of members) {
    if (m.email) taken.add(norm(m.email));
    if (m.login) logins.add(norm(m.login));
  }
  for (const p of pending) taken.add(norm(p.email));
  return people.filter((p) => !logins.has(norm(p.login)) && (!p.email || !taken.has(norm(p.email))));
}

export function visiblePeople<T>(people: T[], showAll: boolean): { shown: T[]; hidden: number } {
  if (showAll || people.length <= PEOPLE_SHOWN) return { shown: people, hidden: 0 };
  return { shown: people.slice(0, PEOPLE_SHOWN), hidden: people.length - PEOPLE_SHOWN };
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
