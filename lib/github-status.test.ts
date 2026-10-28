import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The GitHub drawer's status: gh's account, each folder's repo (cached) and its issue sync. gh and
// lib/github-issues are mocked; folders are real paths so the "isn't there" check is too.

const gh = vi.hoisted((): { result: string | Error; calls: string[][] } => ({ result: "fotoflo\n", calls: [] }));

vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string }) => void) => {
    gh.calls.push(args);
    if (gh.result instanceof Error) cb(gh.result);
    else cb(null, { stdout: gh.result });
  },
}));

const issues = vi.hoisted(() => ({
  repoOf: vi.fn((folder: string) => Promise.resolve(`acme/${folder.split("/").pop()}`)),
  issueSyncFolders: vi.fn((): string[] => []),
  issueSyncStatus: vi.fn((): Record<string, unknown> => ({})),
  ghError: (err: { code?: string; message?: string }) => (err.code === "ENOENT" ? "The GitHub CLI isn't installed. brew install gh, then gh auth login." : (err.message ?? "")),
}));
vi.mock("./github-issues", () => issues);

const hooks = vi.hoisted(() => ({ hookedRepos: vi.fn(() => Promise.resolve({ signedIn: true, repos: [] as string[] })) }));
vi.mock("./github-hooks", () => hooks);

const { clearGithubRepos, githubAccount, githubStatus, MISS_TTL, REPO_TTL } = await import("./github-status");

const HERE = os.tmpdir();
const GONE = "/no/such/folder";

beforeEach(() => {
  clearGithubRepos();
  gh.result = "fotoflo\n";
  gh.calls = [];
  vi.clearAllMocks();
  issues.repoOf.mockImplementation((folder: string) => Promise.resolve(`acme/${folder.split("/").pop()}`));
});

describe("githubAccount", () => {
  it("reads who gh is signed in as", async () => {
    expect(await githubAccount()).toEqual({ account: { login: "fotoflo", url: "https://github.com/fotoflo" }, error: null });
    expect(gh.calls[0]).toEqual(["api", "user", "--jq", ".login"]);
  });

  it("says what to do when gh is missing or signed out", async () => {
    gh.result = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    expect((await githubAccount()).error).toMatch("isn't installed");
    gh.result = "";
    expect(await githubAccount()).toEqual({ account: null, error: "The GitHub CLI isn't logged in. Run gh auth login." });
  });
});

describe("githubStatus", () => {
  it("lists each folder's repo and issue sync", async () => {
    issues.issueSyncFolders.mockReturnValue([HERE]);
    issues.issueSyncStatus.mockReturnValue({ [HERE]: { at: 5, repo: "acme/x", counts: { added: 1, updated: 0, archived: 0 } } });
    const status = await githubStatus([HERE, GONE]);
    expect(status.account?.login).toBe("fotoflo");
    expect(status.folders).toEqual([
      { folder: HERE, repo: `acme/${HERE.split("/").pop()}`, error: null, syncing: true, last: { at: 5, repo: "acme/x", counts: { added: 1, updated: 0, archived: 0 } }, instant: false, workflow: { landing: "backlog" } },
      { folder: GONE, repo: null, error: "folder isn't there anymore.", syncing: false, last: null, instant: false, workflow: { landing: "backlog" } },
    ]);
  });

  it("keeps a repo for REPO_TTL and a miss for MISS_TTL", async () => {
    await githubStatus([HERE], 1000);
    await githubStatus([HERE], 1000 + REPO_TTL - 1);
    expect(issues.repoOf).toHaveBeenCalledTimes(1);
    await githubStatus([HERE], 1000 + REPO_TTL);
    expect(issues.repoOf).toHaveBeenCalledTimes(2);

    issues.repoOf.mockRejectedValue(new Error("x has no GitHub remote, so it has no issues to import."));
    clearGithubRepos();
    const miss = await githubStatus([HERE], 0);
    expect(miss.folders[0]).toMatchObject({ repo: null, error: "x has no GitHub remote, so it has no issues to import." });
    await githubStatus([HERE], MISS_TTL - 1);
    expect(issues.repoOf).toHaveBeenCalledTimes(3);
    await githubStatus([HERE], MISS_TTL);
    expect(issues.repoOf).toHaveBeenCalledTimes(4);
  });

  it("asks for no repos while gh is signed out", async () => {
    gh.result = "";
    const status = await githubStatus([HERE]);
    expect(status.account).toBeNull();
    expect(status.error).toMatch("logged in");
    expect(status.folders[0]).toMatchObject({ repo: null, error: null });
    expect(issues.repoOf).not.toHaveBeenCalled();
  });

  it("marks the folders whose repo has a webhook, and says when the webhooks can't be read", async () => {
    hooks.hookedRepos.mockResolvedValueOnce({ signedIn: true, repos: [`ACME/${HERE.split("/").pop()}`] });
    const status = await githubStatus([HERE]);
    expect(status).toMatchObject({ weft: true, instantError: null });
    expect(status.folders[0]?.instant).toBe(true);

    hooks.hookedRepos.mockRejectedValueOnce(new Error("offline"));
    expect(await githubStatus([HERE])).toMatchObject({ weft: true, instantError: "Couldn't read your webhooks: offline" });
  });
});
