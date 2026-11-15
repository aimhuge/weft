// What simple mode's one-box New thread dialog shows (docs/architecture/simple-mode.md #3), laid out like the phone's
// new-card screen: a header naming the project, project chips when it wasn't opened on one, then the two pills over
// the composer (where it runs, and the model). The pure picks live here; components/NewCardOneBox.tsx draws them.
import { folderName } from "./format";
import { placeOf } from "./new-card-transport";
import { matches } from "./repo-picker";
import type { LocalRepo } from "./types";
import type { WebTarget } from "./web-commands";

// More chips than this and a filter field shows above them, as on the phone.
export const FILTER_FROM = 5;
// The most chips offered: the recent projects first, then the rest of the repos on this Mac.
export const CHIPS_MAX = 24;

export interface ProjectChip {
  path: string;
  label: string;
}

// Project chips come from the same list the folder picker (components/RepoPicker.tsx) loads, and only when the
// dialog has no project picked: opened on a project, it starts there with nothing to pick. A dialog whose folders
// aren't on this machine's disk (weft.zip) picks its place with the where pill instead.
export function wantsProjectChips(local: boolean, defaultCwd?: string): boolean {
  return local && !defaultCwd;
}

// Recent projects, most recently used first, then the other repos, most recently changed first.
export function projectChips(repos: LocalRepo[] | null): ProjectChip[] {
  const all = repos ?? [];
  const recent = all.filter((r) => r.recentAt !== undefined).sort((a, b) => Number(b.recentAt) - Number(a.recentAt));
  const rest = all.filter((r) => r.recentAt === undefined).sort((a, b) => b.activity - a.activity);
  return [...recent, ...rest].slice(0, CHIPS_MAX).map((r) => ({ path: r.path, label: r.name }));
}

// The chips whose name or path match every word typed in the filter.
export function filterChips(chips: ProjectChip[], query: string): ProjectChip[] {
  const q = query.trim();
  return chips.filter((c) => matches(q, c.label, c.path));
}

// The header's "in <project>": a place's own label on weft.zip (its key names the machine too), else the folder's name.
export function oneBoxWhere(cwd: string, places?: WebTarget[]): string {
  if (!cwd) return "";
  const place = places && placeOf(places, cwd);
  return place ? place.label : folderName(cwd);
}

// The where pill shows only when there is a choice to make: more than one place to run it. A plain Mac with no
// workers has none, so the pill stays out.
export function showWherePill(places?: WebTarget[]): boolean {
  return (places?.length ?? 0) > 1;
}

// The composer: tall and filling the dialog in the full layout; in the one-box one, a natural height at the bottom
// with the phone's prompt. The key remounts it when More swaps one for the other, since it is sized at creation.
export function composerLook(full: boolean) {
  return full
    ? {
        key: "full",
        placeholder: "What should this thread do? @ to mention someone, / for skills, paste screenshots or hit the mic and talk.",
        sizeClass: "h-full min-h-[180px]",
        className: "flex-1",
        look: undefined,
      }
    : // The phone's composer (Composer's look="phone"): the same rounded box and voice mode as the reply under the page.
      { key: "one-box", placeholder: "What should it build?", sizeClass: "min-h-[72px] max-h-[40vh]", className: "shrink-0", look: "phone" as const };
}
