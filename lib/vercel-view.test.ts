// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createdText, deployState, ENV_SHORT, envLine, pushAllText, pushText, toPush, vercelActions, gitLine, matchScore, pickerList, projectNameFor, pullText, shownFolders, startScope, toPull, validProjectName, vercelBridge, vercelTitle, type VercelEnvironment, type VercelEnvRow, type VercelFolder, type VercelProject, type VercelStatus } from "./vercel-view";

const project = (name: string, over: Partial<VercelProject> = {}): VercelProject => ({ id: name, name, orgId: "team_1", team: "Acme", teamSlug: "acme", git: null, framework: null, updatedAt: 0, ...over });
const folder = (path: string, repo: string | null = null, over: Partial<VercelFolder> = {}): VercelFolder => ({ folder: path, repo, link: null, error: null, ...over });

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("matchScore", () => {
  it("ranks the same GitHub repo, then the same name, then a partial name", () => {
    const f = folder("/dev/web-app", "Acme/Storefront");
    expect(matchScore(project("x", { git: "acme/storefront" }), f)).toBe(3);
    expect(matchScore(project("storefront"), f)).toBe(2);
    expect(matchScore(project("WebApp"), f)).toBe(2);
    expect(matchScore(project("web"), f)).toBe(1);
    expect(matchScore(project("storefront-staging"), f)).toBe(1);
    expect(matchScore(project("other", { git: "acme/other" }), f)).toBe(0);
    expect(matchScore(project("---"), folder("/dev/x"))).toBe(0);
  });
});

describe("pickerList", () => {
  it("filters by name, team or repo and puts the best fits first, then the newest", () => {
    const list = [project("old", { updatedAt: 1 }), project("new", { updatedAt: 9 }), project("web", { updatedAt: 2, team: "Side", git: "me/web" })];
    expect(pickerList(list, folder("/dev/web")).map((r) => r.project.name)).toEqual(["web", "new", "old"]);
    expect(pickerList(list, folder("/dev/web"), " side ").map((r) => r.project.name)).toEqual(["web"]);
    expect(pickerList(list, folder("/dev/web"), "me/").map((r) => r.project.name)).toEqual(["web"]);
  });
});

describe("deployState", () => {
  it("labels known states and falls back to the raw one", () => {
    expect(deployState("READY")).toEqual({ label: "Ready", tone: "ok" });
    expect(deployState("ERROR").tone).toBe("bad");
    expect(deployState("DELETED")).toEqual({ label: "Deleted", tone: "muted" });
  });
});

describe("vercelActions", () => {
  const latest = { state: "READY", url: null, createdAt: 0, target: "production", page: "https://vercel.com/acme/web/dpl1" };
  it("links the latest deploy, logs, env, domains and dashboard", () => {
    expect(vercelActions({ dashboard: "https://vercel.com/acme/web", latest })).toEqual([
      { label: "Deploy", url: "https://vercel.com/acme/web/dpl1" },
      { label: "Logs", url: "https://vercel.com/acme/web/logs" },
      { label: "Env", url: "https://vercel.com/acme/web/settings/environment-variables" },
      { label: "Domains", url: "https://vercel.com/acme/web/settings/domains" },
      { label: "Dashboard", url: "https://vercel.com/acme/web" },
    ]);
  });
  it("drops what it can't link: no deploy page, a generic dashboard, no dashboard", () => {
    expect(vercelActions({ dashboard: "https://vercel.com/dashboard", latest: { ...latest, page: null } })).toEqual([{ label: "Dashboard", url: "https://vercel.com/dashboard" }]);
    expect(vercelActions({ latest })).toEqual([{ label: "Deploy", url: "https://vercel.com/acme/web/dpl1" }]);
    expect(vercelActions({})).toEqual([]);
  });
});

describe("gitLine", () => {
  it("says whether the project deploys from the folder's repo", () => {
    expect(gitLine({ git: null }, null)).toEqual({ text: "Not deploying from GitHub", warn: true });
    expect(gitLine({ git: null }, "me/web")).toEqual({ text: "Not deploying from GitHub (me/web)", warn: true });
    expect(gitLine({ git: "me/other" }, "me/web")).toEqual({ text: "Deploys from me/other, not me/web", warn: true });
    expect(gitLine({ git: "Me/Web" }, "me/web")).toEqual({ text: "Deploys from Me/Web", warn: false });
    expect(gitLine({ git: "me/web" }, null).warn).toBe(false);
  });
});

describe("shownFolders and vercelTitle", () => {
  const status: VercelStatus = {
    signedIn: true,
    user: { username: "me" },
    error: null,
    folders: [folder("/dev/a", null, { link: { projectId: "p", orgId: "o", name: "alpha" } }), folder("/dev/b", null, { link: { projectId: "q", orgId: "o", name: null } }), folder("/dev/c")],
  };

  it("shows the top bar's project, or every one", () => {
    expect(shownFolders(status.folders, "/dev/c").map((f) => f.folder)).toEqual(["/dev/c"]);
    expect(shownFolders(status.folders, null)).toHaveLength(3);
  });

  it("names the linked projects", () => {
    expect(vercelTitle(null, null)).toBe("Vercel: link this project");
    expect(vercelTitle(status, null)).toBe("Vercel: alpha, b");
    expect(vercelTitle(status, "/dev/c")).toBe("Vercel: not linked yet");
  });
});

describe("new projects", () => {
  it("suggests the repo's name, else the folder's, as Vercel takes it", () => {
    expect(projectNameFor(folder("/dev/x", "Me/My_Site.io"))).toBe("my_site.io");
    expect(projectNameFor(folder("/Users/me/My Cool  App!"))).toBe("my-cool-app");
    expect(projectNameFor(folder("/dev/a----b"))).toBe("a--b");
    expect(projectNameFor(folder("/dev/x", "me/"))).toBe("x");
  });

  it("checks a name", () => {
    expect(validProjectName(" web-app ")).toBe(true);
    expect(validProjectName("Web")).toBe(false);
    expect(validProjectName("a---b")).toBe(false);
    expect(validProjectName("")).toBe(false);
  });

  it("starts on your default team, else the first scope", () => {
    expect(startScope({ scopes: [{ id: null, name: "Personal" }, { id: "t", name: "T" }], defaultId: "t" })).toBe("t");
    expect(startScope({ scopes: [{ id: null, name: "Personal" }, { id: "t", name: "T" }], defaultId: "gone" })).toBeNull();
    expect(startScope({ scopes: [{ id: "t", name: "T" }], defaultId: null })).toBe("t");
    expect(startScope({ scopes: [], defaultId: null })).toBeNull();
  });

  it("says what Create did", () => {
    const made = { created: true as const, name: "web" };
    expect(createdText("/dev/site", { ...made, git: "me/web", gitError: null })).toBe("Made web on Vercel and linked site; pushes to me/web deploy it");
    expect(createdText("/dev/site", { ...made, git: null, gitError: null })).toBe("Made web on Vercel and linked site");
    expect(createdText("/dev/site", { ...made, git: null, gitError: "no access" })).toBe("Made web on Vercel and linked site, but couldn't connect GitHub: no access");
  });
});

describe("vercelBridge", () => {
  it("is the shell's bridge, or null", () => {
    expect(vercelBridge()).toBeNull();
    const bridge = { status: () => null };
    (window as unknown as { weft: unknown }).weft = { vercel: bridge };
    expect(vercelBridge()).toBe(bridge);
  });
});

describe("vault → Vercel env", () => {
  const row = (name: string, environment: VercelEnvironment, inVault: boolean, onVercel: boolean): VercelEnvRow => ({ name, environment, inVault, onVercel });

  it("counts what's left to push", () => {
    const rows = [row("A", "production", true, false), row("B", "production", true, true), row("C", "preview", false, true), row("D", "production", false, false)];
    expect(toPush(rows)).toEqual([rows[0]]);
    expect(envLine(rows)).toBe("1 to push · 1 on Vercel");
    expect(envLine([rows[0]!])).toBe("1 to push");
    expect(envLine([rows[1]!])).toBe("All 1 vault secret is on Vercel");
    expect(envLine([rows[1]!, row("E", "development", true, true)])).toBe("All 2 vault secrets are on Vercel");
    expect(envLine([rows[2]!, rows[3]!])).toBe("No vault values to push yet");
    expect(ENV_SHORT.production).toBe("prod");
  });

  it("words a push, a no and a missing value", () => {
    expect(pushText("K", "production", { pushed: true, project: "weft", label: "a/b" })).toBe("Pushed K to weft (production). It's live from the next deploy");
    expect(pushText("K", "preview", { pushed: true, label: "a/b" })).toBe("Pushed K to Vercel (preview). It's live from the next deploy");
    expect(pushText("K", "production", { denied: true, label: "a/b" })).toBe("K stayed in the vault: Touch ID wasn't approved");
    expect(pushText("K", "development", { missing: true, label: "a/b" })).toBe("K has no development value in the a/b vault");
  });

  it("words a Push all: how many went, a no, nothing, and what failed", () => {
    const base = { label: "a/b", project: "weft" };
    expect(pushAllText({ ...base, sent: [{ name: "A", environment: "production" }] })).toBe("Pushed 1 secret to weft. Live from the next deploy");
    expect(pushAllText({ ...base, denied: true })).toBe("Nothing pushed: Touch ID wasn't approved");
    expect(pushAllText({ ...base, sent: [] })).toBe("Nothing pushed to weft");
    expect(pushAllText({ ...base, failed: [{ name: "B", environment: "preview", error: "Vercel answered 500." }] })).toBe("Nothing pushed to weft. Failed: B (preview): Vercel answered 500.");
  });

  it("counts what Pull would bring down", () => {
    const rows = [{ ...row("A", "production", false, true), pullable: true }, row("B", "production", false, true), { ...row("C", "preview", true, true), pullable: false }];
    expect(toPull(rows)).toEqual([rows[0]]);
    expect(toPull([])).toEqual([]);
  });

  it("words a pull: names once each, nothing new, and what's left to add by hand", () => {
    const e = (name: string, environment: VercelEnvironment) => ({ name, environment });
    const base = { label: "a/b", project: "weft" };
    expect(pullText({ ...base, pulled: [e("A", "development"), e("A", "production"), e("B", "preview")], skipped: [] })).toBe("Pulled A, B into the a/b vault");
    expect(pullText({ ...base, pulled: [], skipped: [] })).toBe("Nothing new to pull from weft");
    expect(pullText({ ...base, pulled: [e("A", "production")], skipped: [e("S", "production"), e("S", "preview"), e("T", "preview")] })).toBe("Pulled A into the a/b vault. Sensitive on Vercel, add by hand: S, T");
    expect(pullText({ ...base, pulled: [], skipped: [e("S", "production")] })).toBe("Nothing new to pull from weft. Sensitive on Vercel, add by hand: S");
    expect(pullText({ ...base, pulled: [], skipped: [e("S", "production")], denied: true })).toBe("Nothing pulled from weft: Touch ID wasn't approved");
    expect(pullText({ ...base, pulled: [e("A", "development")], skipped: [], local: [e("lower", "development")] })).toBe("Pulled A into the a/b vault. Lower-case, so kept out of the shared vault: lower");
  });
});
