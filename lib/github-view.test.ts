import { describe, expect, it } from "vitest";
import { githubTitle, issuesUrl, repoUrl, shownGithubFolders, syncLine, syncToast, type GithubFolder, type GithubStatus } from "./github-view";

const folder = (path: string, over: Partial<GithubFolder> = {}): GithubFolder => ({ folder: path, repo: null, error: null, syncing: false, last: null, instant: false, workflow: { landing: "backlog" }, ...over });
const signedIn = (folders: GithubFolder[]): GithubStatus => ({ account: { login: "fotoflo", url: "https://github.com/fotoflo" }, error: null, weft: true, instantError: null, folders });

describe("github-view", () => {
  it("links a repo and its issues", () => {
    expect(repoUrl("acme/app")).toBe("https://github.com/acme/app");
    expect(issuesUrl("acme/app")).toBe("https://github.com/acme/app/issues");
  });

  it("shows the top bar's project, or every folder", () => {
    const all = [folder("/a"), folder("/b")];
    expect(shownGithubFolders(all, null)).toEqual(all);
    expect(shownGithubFolders(all, "/b")).toEqual([all[1]]);
  });

  it("reads a folder's last sync", () => {
    const now = 10 * 60_000;
    expect(syncLine(folder("/a"))).toBeNull();
    expect(syncLine(folder("/a", { syncing: true }))).toEqual({ text: "Syncing every 5 minutes", bad: false });
    expect(syncLine(folder("/a", { syncing: true, instant: true }))?.text).toBe("Syncing as issues change");
    expect(syncLine(folder("/a", { syncing: true, last: { at: 0, error: "gh broke" } }))).toEqual({ text: "gh broke", bad: true });
    expect(syncLine(folder("/a", { syncing: true, last: { at: now - 3 * 60_000, counts: { added: 2, updated: 1, archived: 1 } } }), now)).toEqual({
      text: "Synced 3m ago · 2 added, 1 updated, 1 archived",
      bad: false,
    });
    expect(syncLine(folder("/a", { syncing: true, last: { at: now, counts: { added: 0, updated: 0, archived: 0 } } }), now)?.text).toBe("Synced just now · no changes");
    expect(syncLine(folder("/a", { syncing: true, last: { at: now } }), now)?.text).toBe("Synced just now · no changes");
  });

  it("words the sync toast", () => {
    expect(syncToast("/dev/app", { added: 3, updated: 0, archived: 1 })).toBe("GitHub issues for app: 3 added, 1 archived");
    expect(syncToast("/dev/app", { added: 0, updated: 0, archived: 0 })).toBe("GitHub issues for app: nothing new");
  });

  it("titles the rail icon", () => {
    expect(githubTitle(null, null)).toBe("GitHub: account and issue sync");
    expect(githubTitle({ account: null, error: "x", weft: false, instantError: null, folders: [] }, null)).toBe("GitHub: sign in with the gh CLI");
    const status = signedIn([folder("/dev/app", { syncing: true }), folder("/dev/web")]);
    expect(githubTitle(status, null)).toBe("GitHub: @fotoflo · issues sync for app");
    expect(githubTitle(status, "/dev/web")).toBe("GitHub: @fotoflo · no issue sync yet");
  });
});
