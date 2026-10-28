import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/github is the GitHub drawer's status; /api/github/issues turns a folder's GitHub issue sync on (syncing it now), off, and lists it.
// lib/github-issues is mocked; the folder check is real, so it uses a folder that exists.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/github-issues", () => ({
  syncIssues: vi.fn(() => Promise.resolve({ added: 2, updated: 1, archived: 0 })),
  enableIssueSync: vi.fn(),
  disableIssueSync: vi.fn(),
  issueSyncFolders: vi.fn(() => ["/dev/app"]),
  issueSyncStatus: vi.fn(() => ({ "/dev/app": { at: 1, repo: "acme/app" } })),
}));

vi.mock("@/lib/github-hooks", () => ({
  addHook: vi.fn(() => Promise.resolve({ repo: "acme/app" })),
  removeHook: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/github-relay", () => ({
  handle: vi.fn(() => Promise.resolve(new Response("Saved"))),
  restStore: vi.fn(() => ({})),
}));
vi.mock("@/lib/github-status", () => ({
  githubStatus: vi.fn((folders: string[]) => Promise.resolve({ account: { login: "me", url: "https://github.com/me" }, error: null, folders })),
}));
// Where each folder's issue cards land, and how a "run" card works (lib/issue-landing.ts).
const saved = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/settings", () => ({
  setIssueWorkflow: vi.fn((folder: string, workflow: unknown) => saved.set(folder, workflow)),
  issueWorkflow: vi.fn((folder: string) => saved.get(folder) ?? { landing: "backlog" }),
}));

const lib = await import("@/lib/github-issues");
const status = await import("@/lib/github-status");
const route = await import("./github/issues/route");
const drawer = await import("./github/route");
const hooks = await import("@/lib/github-hooks");
const hookRoute = await import("./github/hooks/route");
const relay = await import("@/lib/github-relay");
const settings = await import("@/lib/settings");
const webhook = await import("./github/webhook/route");

const URL = "http://localhost:3457/api/github/issues";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const FOLDER = os.tmpdir();

const send = (method: string, body: unknown, headers: Record<string, string> = WRITE) =>
  new Request(URL, { method, headers, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  saved.clear();
});

describe("GET /api/github/issues", () => {
  it("lists the folders that sync and their last sync", async () => {
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(await res.json()).toEqual({ folders: ["/dev/app"], status: { "/dev/app": { at: 1, repo: "acme/app" } } });
  });

  it("refuses other hosts", async () => {
    expect((await route.GET(new Request("http://evil.test/api/github/issues", { headers: { host: "evil.test" } }))).status).toBe(403);
  });
});

describe("POST /api/github/issues", () => {
  it("syncs the folder now, turns its sync on and returns the counts", async () => {
    const res = await route.POST(send("POST", { folder: FOLDER }));
    expect(await res.json()).toEqual({ folder: FOLDER, added: 2, updated: 1, archived: 0 });
    expect(lib.syncIssues).toHaveBeenCalledWith(FOLDER);
    expect(lib.enableIssueSync).toHaveBeenCalledWith(FOLDER);
  });

  it("leaves sync off when the sync fails, and says why", async () => {
    vi.mocked(lib.syncIssues).mockRejectedValueOnce(new Error("app has no GitHub remote, so it has no issues to import."));
    const res = await route.POST(send("POST", { folder: FOLDER }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch("no GitHub remote");
    expect(lib.enableIssueSync).not.toHaveBeenCalled();
  });

  it("refuses a missing folder and a write without the header", async () => {
    expect((await route.POST(send("POST", { folder: "/no/such/folder" }))).status).toBe(400);
    expect((await route.POST(send("POST", { folder: FOLDER }, READ))).status).toBe(403);
    expect(lib.syncIssues).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/github/issues", () => {
  it("turns the folder's sync off", async () => {
    const res = await route.DELETE(send("DELETE", { folder: "/dev/app" }));
    expect(await res.json()).toEqual({ folders: ["/dev/app"] });
    expect(lib.disableIssueSync).toHaveBeenCalledWith("/dev/app");
    expect(hooks.removeHook).toHaveBeenCalledWith("/dev/app");
  });

  it("still turns sync off when the webhook won't come off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(hooks.removeHook).mockRejectedValueOnce(new Error("offline"));
    expect((await route.DELETE(send("DELETE", { folder: "/dev/app" }))).status).toBe(200);
    expect(warn).toHaveBeenCalledWith("GitHub webhook for /dev/app: offline");
    warn.mockRestore();
  });

  it("needs a folder and the header", async () => {
    expect((await route.DELETE(send("DELETE", {}))).status).toBe(400);
    expect((await route.DELETE(send("DELETE", { folder: "/dev/app" }, READ))).status).toBe(403);
    expect(lib.disableIssueSync).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/github/issues", () => {
  it("saves where the folder's cards land, with the skill and the agent", async () => {
    const res = await route.PATCH(send("PATCH", { folder: FOLDER, landing: "run", skill: "weft:plan", agent: "triage" }));
    expect(await res.json()).toEqual({ folder: FOLDER, workflow: { landing: "run", skill: "weft:plan", agent: "triage" } });
    expect(settings.setIssueWorkflow).toHaveBeenCalledWith(FOLDER, { landing: "run", skill: "weft:plan", agent: "triage" });
  });

  it("saves a landing with no skill and no agent", async () => {
    const res = await route.PATCH(send("PATCH", { folder: FOLDER, landing: "needs_you" }));
    expect(await res.json()).toEqual({ folder: FOLDER, workflow: { landing: "needs_you" } });
  });

  it("refuses a landing it doesn't know, a missing folder and a write without the header", async () => {
    const bad = await route.PATCH(send("PATCH", { folder: FOLDER, landing: "sideways" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch("Pick where the cards land");
    expect((await route.PATCH(send("PATCH", { folder: "/no/such/folder", landing: "run" }))).status).toBe(400);
    expect((await route.PATCH(send("PATCH", { folder: FOLDER, landing: "run" }, READ))).status).toBe(403);
    expect(settings.setIssueWorkflow).not.toHaveBeenCalled();
  });
});

describe("GET /api/github", () => {
  it("returns the account and each asked-for folder", async () => {
    const res = await drawer.GET(new Request("http://localhost:3457/api/github?folder=%2Fdev%2Fa&folder=%2Fdev%2Fb&folder=", { headers: READ }));
    expect(((await res.json()) as { folders: string[] }).folders).toEqual(["/dev/a", "/dev/b"]);
    expect(status.githubStatus).toHaveBeenCalledWith(["/dev/a", "/dev/b"]);
  });

  it("refuses other hosts and reports a failure", async () => {
    expect((await drawer.GET(new Request("http://evil.test/api/github", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(status.githubStatus).mockRejectedValueOnce(new Error("boom"));
    expect((await drawer.GET(new Request("http://localhost:3457/api/github", { headers: READ }))).status).toBe(400);
  });
});

describe("/api/github/hooks", () => {
  it("adds and removes the folder's webhook", async () => {
    expect(await (await hookRoute.POST(send("POST", { folder: FOLDER }))).json()).toEqual({ repo: "acme/app" });
    expect(hooks.addHook).toHaveBeenCalledWith(FOLDER);
    expect(await (await hookRoute.DELETE(send("DELETE", { folder: FOLDER }))).json()).toEqual({ ok: true });
    expect(hooks.removeHook).toHaveBeenCalledWith(FOLDER);
  });

  it("says why a webhook couldn't be added or removed, and refuses a write without the header", async () => {
    vi.mocked(hooks.addHook).mockRejectedValueOnce(new Error("Adding a webhook to acme/app needs admin rights on it."));
    const res = await hookRoute.POST(send("POST", { folder: FOLDER }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch("admin rights");
    vi.mocked(hooks.removeHook).mockRejectedValueOnce(new Error("nope"));
    expect((await hookRoute.DELETE(send("DELETE", { folder: FOLDER }))).status).toBe(400);
    expect((await hookRoute.POST(send("POST", { folder: FOLDER }, READ))).status).toBe(403);
    expect((await hookRoute.DELETE(send("DELETE", { folder: FOLDER }, READ))).status).toBe(403);
  });
});

describe("POST /api/github/webhook", () => {
  const delivery = () => new Request("https://weft.example/api/github/webhook?hook=x", { method: "POST", headers: { host: "weft.example" }, body: "{}" });

  it("says when the relay isn't set up, with no localhost guard in the way", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await webhook.POST(delivery());
    expect(res.status).toBe(503);
    expect(relay.handle).not.toHaveBeenCalled();
  });

  it("hands the delivery to the relay with a store on Weft's Supabase", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const res = await webhook.POST(delivery());
    expect(res.status).toBe(200);
    expect(relay.restStore).toHaveBeenCalledWith(expect.stringContaining("supabase.co"), "sb_secret_x");
  });

  it("answers 502 when Supabase fails", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(relay.handle).mockRejectedValueOnce(new Error("Supabase 500: down"));
    expect((await webhook.POST(delivery())).status).toBe(502);
    expect(error).toHaveBeenCalledWith("GitHub webhook: Supabase 500: down");
    error.mockRestore();
    vi.unstubAllEnvs();
  });
});
