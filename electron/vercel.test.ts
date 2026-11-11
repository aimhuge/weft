import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readLink } from "./vercel-project.cjs";
import { createVercel, registerVercel, TOKEN_FILE } from "./vercel.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

type Route = (url: URL) => { status?: number; body: unknown };

// A fake api.vercel.com: routes by path, answers 404 otherwise. Records each URL and its token.
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: URL; auth: string | undefined; method: string; body: string | undefined }[] = [];
  const fetch = vi.fn((url: URL, init: { headers: Record<string, string>; method: string; body?: string }) => {
    calls.push({ url, auth: init.headers.Authorization, method: init.method, body: init.body });
    const route = routes[url.pathname];
    const answer = typeof route === "function" ? (route as Route)(url) : route === undefined ? { status: 404, body: { error: { message: "Not found" } } } : { body: route };
    const status = answer.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => (answer.body === "bad json" ? Promise.reject(new Error("x")) : Promise.resolve(answer.body)) });
  });
  return { fetch, calls };
}

const PROJECT = {
  id: "prj_1",
  name: "web",
  accountId: "team_a",
  link: { type: "github", org: "me", repo: "web" },
  targets: { production: { alias: ["web.example.com"] } },
};

const API = {
  "/v2/user": { user: { username: "fotoflo" } },
  "/v2/teams": { teams: [{ id: "team_a", name: "Acme", slug: "acme" }] },
  "/v9/projects/prj_1": PROJECT,
  "/v6/deployments": { deployments: [{ url: "web-abc.vercel.app", readyState: "READY", createdAt: 5, target: "production", inspectorUrl: "https://vercel.com/acme/web/dpl1" }] },
};

function make(routes: Record<string, unknown> = API, remote = "git@github.com:me/web.git") {
  const dataDir = tmp("weft-data-");
  const { fetch, calls } = fakeFetch(routes);
  const vercel = createVercel({ dataDir, safeStorage, fetch: fetch as unknown as typeof globalThis.fetch, remote: () => Promise.resolve(remote) });
  return { vercel, dataDir, calls };
}

describe("createVercel", () => {
  it("shows folders without asking Vercel before a token is saved", async () => {
    const { vercel, calls } = make();
    const folder = tmp("weft-proj-");
    expect(await vercel.status([folder])).toEqual({ signedIn: false, user: null, error: null, folders: [{ folder, repo: "me/web", link: null, error: null }] });
    expect(calls).toHaveLength(0);
    await expect(vercel.projects()).rejects.toThrow("Add a Vercel token first.");
  });

  it("checks a token with Vercel and keeps it sealed", async () => {
    const { vercel, dataDir, calls } = make();
    await expect(vercel.setToken("  ")).rejects.toThrow("Paste a token");
    expect(await vercel.setToken(" tok ")).toEqual({ username: "fotoflo" });
    expect(calls[0]?.auth).toBe("Bearer tok");
    const saved = fs.readFileSync(path.join(dataDir, TOKEN_FILE), "utf8");
    expect(saved).not.toContain("tok\"");
    expect(fs.statSync(path.join(dataDir, TOKEN_FILE)).mode & 0o777).toBe(0o600);
    expect(vercel.forgetToken()).toEqual({ signedIn: false });
    expect(fs.existsSync(path.join(dataDir, TOKEN_FILE))).toBe(false);
  });

  it("names the user by email, or as you, when Vercel gives no username", async () => {
    const email = make({ "/v2/user": { user: { email: "a@b.c" } } });
    expect(await email.vercel.setToken("t")).toEqual({ username: "a@b.c" });
    expect((await email.vercel.status([])).user).toEqual({ username: "a@b.c" });
    const none = make({ "/v2/user": {} });
    expect(await none.vercel.setToken("t")).toEqual({ username: "you" });
    expect((await none.vercel.status([])).user).toEqual({ username: "you" });
  });

  it("refuses a token Vercel turns down, or without the Keychain", async () => {
    const { vercel } = make({ "/v2/user": () => ({ status: 403, body: {} }) });
    await expect(vercel.setToken("bad")).rejects.toThrow("turned the token down");
    const locked = createVercel({ dataDir: tmp("weft-data-"), safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });
    await expect(locked.setToken("t")).rejects.toThrow("Keychain");
  });

  it("reports a saved token that stopped working, keeping each folder's link ids", async () => {
    let status = 200;
    const { vercel } = make({ ...API, "/v2/user": () => ({ status, body: { user: { username: "fotoflo" } } }) });
    await vercel.setToken("tok");
    status = 401;
    const folder = tmp("weft-proj-");
    fs.mkdirSync(path.join(folder, ".vercel"));
    fs.writeFileSync(path.join(folder, ".vercel/project.json"), JSON.stringify({ projectId: "prj_1", orgId: "team_a", projectName: "web" }));
    const s = await vercel.status([folder]);
    expect(s).toMatchObject({ signedIn: true, user: null });
    expect(s.error).toContain("turned the token down");
    expect(s.folders[0]?.link).toEqual({ projectId: "prj_1", orgId: "team_a", name: "web" });
  });

  it("lists projects across your account and teams, newest first, once each", async () => {
    const { vercel, calls } = make({
      ...API,
      "/v10/projects": (url: URL) =>
        url.searchParams.get("teamId")
          ? { body: { projects: [{ ...PROJECT, updatedAt: 9 }, { id: "prj_2", name: "docs", accountId: "team_a", framework: "nextjs", updatedAt: 2 }] } }
          : { body: { projects: [{ id: "prj_1", name: "web", accountId: "team_a", updatedAt: 9 }, { id: "prj_3", name: "mine", accountId: "u_1" }] } },
    });
    await vercel.setToken("tok");
    const list = await vercel.projects();
    expect(list.map((p: { id: string }) => p.id)).toEqual(["prj_1", "prj_2", "prj_3"]);
    expect(list[1]).toEqual({ id: "prj_2", name: "docs", orgId: "team_a", team: "Acme", teamSlug: "acme", git: null, framework: "nextjs", updatedAt: 2 });
    expect(list[2]).toMatchObject({ team: "Personal", teamSlug: null, updatedAt: 0 });
    await vercel.projects();
    expect(calls.filter((c) => c.url.pathname === "/v2/teams")).toHaveLength(1);
  });

  it("leaves out a scope that fails, unless they all do", async () => {
    let personal = 200;
    let team = 200;
    const { vercel } = make({
      ...API,
      "/v2/teams": { teams: [{ id: "team_a", slug: "acme" }] },
      "/v10/projects": (url: URL) => (url.searchParams.get("teamId") ? { status: team, body: { projects: [PROJECT] } } : { status: personal, body: {} }),
    });
    await vercel.setToken("tok");
    personal = 500;
    expect((await vercel.projects()).map((p: { team: string }) => p.team)).toEqual(["acme"]);
    team = 500;
    await expect(vercel.projects()).rejects.toThrow("Vercel answered 500.");
  });

  it("asks for teams with no list in the answer", async () => {
    const { vercel } = make({ ...API, "/v2/teams": {}, "/v10/projects": {} });
    await vercel.setToken("tok");
    expect(await vercel.projects()).toEqual([]);
  });

  it("links a folder like `vercel link` does, shows it, and unlinks it", async () => {
    const { vercel, calls } = make();
    await vercel.setToken("tok");
    const folder = tmp("weft-proj-");
    expect(await vercel.link(folder, "prj_1", "team_a")).toEqual({ linked: true, name: "web" });
    expect(readLink(folder)).toEqual({ projectId: "prj_1", orgId: "team_a", projectName: "web" });
    expect(fs.readFileSync(path.join(folder, ".gitignore"), "utf8")).toBe(".vercel\n");
    expect(calls.at(-1)?.url.searchParams.get("teamId")).toBe("team_a");

    const s = await vercel.status([folder]);
    expect(s).toMatchObject({ signedIn: true, user: { username: "fotoflo" }, error: null });
    expect(s.folders[0]).toEqual({
      folder,
      repo: "me/web",
      error: null,
      link: {
        projectId: "prj_1",
        orgId: "team_a",
        name: "web",
        team: "Acme",
        git: "me/web",
        url: "https://web.example.com",
        dashboard: "https://vercel.com/acme/web",
        latest: { state: "READY", url: "https://web-abc.vercel.app", createdAt: 5, target: "production", page: "https://vercel.com/acme/web/dpl1" },
      },
    });
    expect(vercel.unlink(folder)).toEqual({ linked: false });
    expect(readLink(folder)).toBeNull();
  });

  it("links a personal project without a team, and shows it with no deploys", async () => {
    const { vercel, calls } = make({ ...API, "/v9/projects/prj_9": { id: "prj_9", name: "solo", accountId: "u_1" }, "/v6/deployments": {} }, "https://gitlab.com/me/solo.git");
    await vercel.setToken("tok");
    const folder = tmp("weft-proj-");
    await vercel.link(folder, "prj_9", "u_1");
    expect(calls.at(-1)?.url.searchParams.has("teamId")).toBe(false);
    const row = (await vercel.status([folder])).folders[0];
    expect(row?.repo).toBeNull();
    expect(row?.link).toMatchObject({ name: "solo", team: null, dashboard: "https://vercel.com/fotoflo/solo", latest: null, git: null, url: null });
  });

  it("keeps a link Vercel can't read, with the error, and refuses a missing folder", async () => {
    const { vercel } = make({ ...API, "/v9/projects/gone": () => ({ status: 404, body: "bad json" }) });
    await vercel.setToken("tok");
    await expect(vercel.link("/no/such/folder", "prj_1", "team_a")).rejects.toThrow("isn't a folder");
    const folder = tmp("weft-proj-");
    fs.mkdirSync(path.join(folder, ".vercel"));
    fs.writeFileSync(path.join(folder, ".vercel/project.json"), JSON.stringify({ projectId: "gone", orgId: "team_a" }));
    const row = (await vercel.status([folder])).folders[0];
    expect(row).toMatchObject({ link: { projectId: "gone", orgId: "team_a", name: null }, error: "Vercel answered 404." });
  });

  it("offers your teams for a new project, and your own account only without a default team", async () => {
    const team = make({ ...API, "/v2/user": { user: { username: "me", defaultTeamId: "team_a" } } });
    await team.vercel.setToken("tok");
    expect(await team.vercel.scopes()).toEqual({ scopes: [{ id: "team_a", name: "Acme" }], defaultId: "team_a" });
    const old = make({ ...API, "/v2/user": {} });
    await old.vercel.setToken("tok");
    expect(await old.vercel.scopes()).toEqual({ scopes: [{ id: null, name: "Personal" }, { id: "team_a", name: "Acme" }], defaultId: null });
  });

  it("creates a project in a team with the folder's framework, links it, and connects GitHub", async () => {
    const posts: { path: string; team: string | null; body: unknown }[] = [];
    const record = (body: unknown) => (url: URL) => {
      posts.push({ path: url.pathname, team: url.searchParams.get("teamId"), body });
      return { body };
    };
    const { vercel, calls } = make({ ...API, "/v11/projects": record({ id: "prj_new", name: "web", accountId: "team_a" }), "/v9/projects/prj_new/link": record({}) });
    await vercel.setToken("tok");
    const folder = tmp("weft-proj-");
    fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ dependencies: { next: "16", react: "19" } }));
    expect(await vercel.create(folder, { name: " Web ", teamId: "team_a", git: true })).toEqual({ created: true, name: "web", git: "me/web", gitError: null });
    expect(posts.map((p) => [p.path, p.team])).toEqual([["/v11/projects", "team_a"], ["/v9/projects/prj_new/link", "team_a"]]);
    const sent = calls.filter((c) => c.method === "POST").map((c) => JSON.parse(c.body ?? "{}") as unknown);
    expect(sent).toEqual([{ name: "web", framework: "nextjs" }, { type: "github", repo: "me/web" }]);
    expect(readLink(folder)).toEqual({ projectId: "prj_new", orgId: "team_a", projectName: "web" });
  });

  it("keeps a new project when GitHub won't connect, and skips GitHub when asked or with no repo", async () => {
    const { vercel, calls } = make({
      ...API,
      "/v11/projects": { id: "prj_new", name: "solo" },
      "/v9/projects/prj_new/link": () => ({ status: 400, body: { error: { message: "Install the GitHub app" } } }),
    });
    await vercel.setToken("tok");
    const folder = tmp("weft-proj-");
    expect(await vercel.create(folder, { name: "solo", teamId: null, git: true })).toEqual({ created: true, name: "solo", git: null, gitError: "Install the GitHub app" });
    expect(readLink(folder)).toEqual({ projectId: "prj_new", orgId: "", projectName: "solo" });
    expect(calls.find((c) => c.url.pathname === "/v11/projects")?.url.searchParams.has("teamId")).toBe(false);
    const before = calls.length;
    expect(await vercel.create(folder, { name: "solo", teamId: "team_b", git: false })).toMatchObject({ git: null, gitError: null });
    expect(readLink(folder)).toMatchObject({ orgId: "team_b" });
    expect(calls.slice(before).some((c) => c.url.pathname.endsWith("/link"))).toBe(false);
    const noRepo = make({ ...API, "/v11/projects": { id: "p", name: "x", accountId: "u" } }, "https://gitlab.com/me/x.git");
    await noRepo.vercel.setToken("tok");
    expect(await noRepo.vercel.create(tmp("weft-proj-"), { name: "x", teamId: null, git: true })).toMatchObject({ git: null, gitError: null });
  });

  it("refuses a name Vercel won't take, or a missing folder", async () => {
    const { vercel } = make();
    await vercel.setToken("tok");
    for (const name of ["", "a---b", "has space", "x".repeat(101)]) await expect(vercel.create(tmp("weft-proj-"), { name, teamId: null, git: false })).rejects.toThrow("project name");
    await expect(vercel.create("/no/such/folder", { name: "ok", teamId: null, git: false })).rejects.toThrow("isn't a folder");
  });

  it("uses Vercel's own error message", async () => {
    const { vercel } = make({ ...API, "/v9/projects/x": () => ({ status: 400, body: { error: { message: "Bad project" } } }) });
    await vercel.setToken("tok");
    await expect(vercel.link(tmp("weft-proj-"), "x", "team_a")).rejects.toThrow("Bad project");
  });

  it("finds the repo with git for real", async () => {
    const vercel = createVercel({ dataDir: tmp("weft-data-"), safeStorage });
    const [row] = (await vercel.status([os.tmpdir()])).folders;
    expect(row?.repo).toBeNull();
  });
});

describe("registerVercel", () => {
  it("answers the board window only and passes arguments through", async () => {
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = {};
    const vercel = { status: vi.fn(), setToken: vi.fn(), forgetToken: vi.fn(), projects: vi.fn(), scopes: vi.fn(), link: vi.fn(), create: vi.fn(), unlink: vi.fn() };
    registerVercel(ipcMain, { vercel, env: null, isBoard: (s: unknown) => s === board });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);
    await expect(handlers.get("vercel:status")!({ sender: {} }, [])).rejects.toThrow("board window");
    await call("vercel:status", ["/a", 3]);
    await call("vercel:status", "nope");
    await call("vercel:set-token", undefined);
    await call("vercel:forget-token");
    await call("vercel:projects");
    await call("vercel:link", "/a", "p", "o");
    await call("vercel:unlink", "/a");
    await call("vercel:scopes");
    await call("vercel:create", "/a", { name: "web", teamId: "team_a", git: true });
    await call("vercel:create", "/a", { teamId: 3, git: "yes" });
    await call("vercel:create", "/a", null);
    expect(vercel.scopes).toHaveBeenCalled();
    expect(vercel.create.mock.calls).toEqual([
      ["/a", { name: "web", teamId: "team_a", git: true }],
      ["/a", { name: "", teamId: null, git: false }],
      ["/a", { name: "", teamId: null, git: false }],
    ]);
    expect(vercel.status.mock.calls).toEqual([[["/a"]], [[]]]);
    expect(vercel.setToken).toHaveBeenCalledWith("");
    expect(vercel.forgetToken).toHaveBeenCalled();
    expect(vercel.projects).toHaveBeenCalled();
    expect(vercel.link).toHaveBeenCalledWith("/a", "p", "o");
    expect(vercel.unlink).toHaveBeenCalledWith("/a");
    expect(handlers.has("vercel:env-push")).toBe(false);
  });

  it("adds the env handlers when it has the vault's side", async () => {
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = {};
    const env = { status: vi.fn(), push: vi.fn(), pull: vi.fn() };
    registerVercel(ipcMain, { vercel: {}, env, isBoard: (s: unknown) => s === board });
    await handlers.get("vercel:env-status")!({ sender: board }, "/a");
    await handlers.get("vercel:env-pull")!({ sender: board }, "/a");
    await expect(handlers.get("vercel:env-pull")!({ sender: {} }, "/a")).rejects.toThrow("board window");
    expect(env.pull).toHaveBeenCalledTimes(1);
    // The drawer's Pull asks Touch ID; the control server's (the webhook) doesn't.
    expect(env.pull).toHaveBeenCalledWith("/a", { confirm: true });
    await handlers.get("vercel:env-push")!({ sender: board }, "/a", "KEY", "production");
    await expect(handlers.get("vercel:env-push")!({ sender: {} }, "/a", "KEY", "production")).rejects.toThrow("board window");
    expect(env.status).toHaveBeenCalledWith("/a");
    expect(env.push).toHaveBeenCalledWith("/a", "KEY", "production");
  });
});
