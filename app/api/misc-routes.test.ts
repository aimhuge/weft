import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

// The read-only picker routes (repos, skills, quality), the new-thread splash page, and the error
// paths of the projects routes. Every lib they call is mocked except resolveFolder, which gets real temp folders.

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/repos", () => ({
  localRepos: vi.fn(() => [{ path: "/dev/app", name: "app", git: true, activity: 1 }]),
  githubRepos: vi.fn(() => Promise.resolve([{ fullName: "me/app", private: false, pushedAt: 1 }])),
}));
vi.mock("@/lib/skills", () => ({ listSkills: vi.fn(() => [{ name: "weft:done", description: "d", source: "weft" }]) }));
vi.mock("@/lib/quality", () => ({ measureQuality: vi.fn(() => ({ score: 90, root: "/dev/app" })) }));
vi.mock("@/lib/show", () => ({ newThreadUrl: vi.fn(() => "file:///pages/new-thread.html") }));
vi.mock("@/lib/settings", () => ({
  listProjects: vi.fn(() => []),
  touchProject: vi.fn(),
  removeProject: vi.fn(),
}));
vi.mock("@/lib/skill-set-actions", () => ({
  // Mirrors the real isSkillName so 400s on bogus names are real validation, not a bypass.
  isSkillName: (name: unknown) => typeof name === "string" && (/^[\w.-]+(:[\w.-]+)?$/.test(name) || (name.includes("@") && /^[\w.-]+@[\w.-]+$/.test(name))),
  setCardSkill: vi.fn(),
  setProjectSkill: vi.fn(),
  skillSetView: vi.fn(),
}));
const cardStore = new Map<string, { id: string; cwd: string }>();
vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  getCard: (id: string) => cardStore.get(id),
}));

const repos = await import("@/lib/repos");
const skills = await import("@/lib/skills");
const quality = await import("@/lib/quality");
const show = await import("@/lib/show");
const settings = await import("@/lib/settings");
const skillSetActions = await import("@/lib/skill-set-actions");

const reposRoute = await import("./repos/route");
const githubRoute = await import("./repos/github/route");
const skillsRoute = await import("./skills/route");
const qualityRoute = await import("./quality/route");
const newThreadPageRoute = await import("./new-thread-page/route");
const projectsRoute = await import("./projects/route");
const newProjectRoute = await import("./projects/new/route");
const skillSetRoute = await import("./skills/set/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const READ = { host: "localhost:3457" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-misc-api-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  vi.clearAllMocks();
  cardStore.clear();
});

const reads: [string, (r: Request) => Promise<Response>][] = [
  ["GET /repos", (r) => reposRoute.GET(r)],
  ["GET /repos/github", (r) => githubRoute.GET(r)],
  ["GET /skills", (r) => skillsRoute.GET(r)],
  ["GET /quality", (r) => qualityRoute.GET(r)],
];

describe("guard", () => {
  it.each(reads)("%s rejects a foreign host and runs nothing", async (_name, call) => {
    const res = await call(req("/x?cwd=/a", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(repos.localRepos).not.toHaveBeenCalled();
    expect(repos.githubRepos).not.toHaveBeenCalled();
    expect(skills.listSkills).not.toHaveBeenCalled();
    expect(quality.measureQuality).not.toHaveBeenCalled();
  });

  it.each(reads)("%s needs no x-weft-token header", async (_name, call) => {
    expect((await call(req("/x", { headers: READ }))).status).toBe(200);
  });

  it("POST /new-thread-page rejects a foreign host and a missing x-weft-token header", () => {
    expect(newThreadPageRoute.POST(req("/new-thread-page", { method: "POST", headers: { host: "evil.com", "x-weft-token": "1" } })).status).toBe(403);
    expect(newThreadPageRoute.POST(req("/new-thread-page", { method: "POST", headers: READ })).status).toBe(403);
    expect(show.newThreadUrl).not.toHaveBeenCalled();
  });
});

describe("GET /repos", () => {
  it("returns the local repos, from cache unless ?fresh", async () => {
    const res = await reposRoute.GET(req("/repos", { headers: READ }));
    expect(await res.json()).toEqual({ repos: [{ path: "/dev/app", name: "app", git: true, activity: 1 }] });
    expect(repos.localRepos).toHaveBeenLastCalledWith({ fresh: false });
    await reposRoute.GET(req("/repos?fresh", { headers: READ }));
    expect(repos.localRepos).toHaveBeenLastCalledWith({ fresh: true });
  });

  it("500s with the error when the scan throws", async () => {
    vi.mocked(repos.localRepos).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    const res = await reposRoute.GET(req("/repos", { headers: READ }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "EACCES" });
  });
});

describe("GET /repos/github", () => {
  it("returns the GitHub repos, fresh with ?fresh=1", async () => {
    const res = await githubRoute.GET(req("/repos/github", { headers: READ }));
    expect(await res.json()).toEqual({ repos: [{ fullName: "me/app", private: false, pushedAt: 1 }] });
    expect(repos.githubRepos).toHaveBeenLastCalledWith({ fresh: false });
    await githubRoute.GET(req("/repos/github?fresh=1", { headers: READ }));
    expect(repos.githubRepos).toHaveBeenLastCalledWith({ fresh: true });
  });

  it("502s with gh's message when gh fails", async () => {
    vi.mocked(repos.githubRepos).mockRejectedValueOnce(new Error("The GitHub CLI isn't logged in. Run gh auth login."));
    const res = await githubRoute.GET(req("/repos/github", { headers: READ }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The GitHub CLI isn't logged in. Run gh auth login." });
  });
});

describe("GET /skills", () => {
  it("lists the skills for ?cwd=, or without a folder when it's missing or empty", async () => {
    const res = await skillsRoute.GET(req("/skills?cwd=%2Fdev%2Fapp", { headers: READ }));
    expect(await res.json()).toEqual({ skills: [{ name: "weft:done", description: "d", source: "weft" }] });
    expect(skills.listSkills).toHaveBeenLastCalledWith("/dev/app");
    await skillsRoute.GET(req("/skills?cwd=", { headers: READ }));
    expect(skills.listSkills).toHaveBeenLastCalledWith(undefined);
    await skillsRoute.GET(req("/skills", { headers: READ }));
    expect(skills.listSkills).toHaveBeenLastCalledWith(undefined);
  });

  it("lists a card's own folder's skills for ?card=, as the skills.list verb, and 404s a card that isn't here", async () => {
    cardStore.set("c9", { id: "c9", cwd: "/dev/card" });
    const res = await skillsRoute.GET(req("/skills?card=c9", { headers: READ }));
    expect(await res.json()).toEqual({ skills: [{ name: "weft:done", description: "d", source: "weft" }] });
    expect(skills.listSkills).toHaveBeenLastCalledWith("/dev/card");
    const gone = await skillsRoute.GET(req("/skills?card=nope", { headers: READ }));
    expect(gone.status).toBe(404);
    cardStore.delete("c9");
  });
});

describe("GET /quality", () => {
  it("is null without ?cwd= and doesn't measure", async () => {
    const res = await qualityRoute.GET(req("/quality", { headers: READ }));
    expect(await res.json()).toEqual({ quality: null });
    expect(quality.measureQuality).not.toHaveBeenCalled();
  });

  it("returns the report for the folder", async () => {
    const res = await qualityRoute.GET(req("/quality?cwd=%2Fdev%2Fapp", { headers: READ }));
    expect(await res.json()).toEqual({ quality: { score: 90, root: "/dev/app" } });
    expect(quality.measureQuality).toHaveBeenCalledWith("/dev/app");
  });

  it("500s when measuring fails", async () => {
    vi.mocked(quality.measureQuality).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    const res = await qualityRoute.GET(req("/quality?cwd=/x", { headers: READ }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "EACCES" });
  });
});

describe("POST /new-thread-page", () => {
  it("returns the splash page url", async () => {
    const res = newThreadPageRoute.POST(req("/new-thread-page", { method: "POST" }));
    expect(await res.json()).toEqual({ url: "file:///pages/new-thread.html" });
  });

  it("400s when the page can't be written", async () => {
    vi.mocked(show.newThreadUrl).mockImplementationOnce(() => {
      throw new Error("ENOSPC");
    });
    const res = newThreadPageRoute.POST(req("/new-thread-page", { method: "POST" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ENOSPC" });
  });
});

describe("/projects error paths", () => {
  it("GET lists the recent projects", async () => {
    vi.mocked(settings.listProjects).mockReturnValueOnce([{ path: "/dev/app", lastUsedAt: 1 }]);
    expect(await (await projectsRoute.GET(req("/projects", { headers: READ }))).json()).toEqual({ projects: [{ path: "/dev/app", lastUsedAt: 1 }] });
  });

  it("POST 400s a body without a path", async () => {
    const res = await projectsRoute.POST(req("/projects", { method: "POST", body: {} }));
    expect(await res.json()).toEqual({ error: "Choose a folder." });
    expect(res.status).toBe(400);
  });

  it("DELETE 400s a body that isn't JSON and removes nothing", async () => {
    const res = await projectsRoute.DELETE(req("/projects", { method: "DELETE", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(settings.removeProject).not.toHaveBeenCalled();
  });

  it("DELETE treats a missing path as an empty one", async () => {
    await projectsRoute.DELETE(req("/projects", { method: "DELETE", body: {} }));
    expect(settings.removeProject).toHaveBeenCalledWith("");
  });
});

describe("POST /projects/new error paths", () => {
  const post = (body: unknown) => newProjectRoute.POST(req("/projects/new", { method: "POST", body }));

  it("400s a missing name or parent with a message saying which", async () => {
    expect(await (await post({ parent: tmp })).json()).toEqual({ error: "Use letters, numbers, dots, dashes, and underscores for the name." });
    expect(await (await post({ name: "app" })).json()).toEqual({ error: "Choose a parent folder." });
  });

  it("says when a file is in the way", async () => {
    fs.writeFileSync(path.join(tmp, "taken"), "x");
    expect(await (await post({ parent: tmp, name: "taken" })).json()).toEqual({ error: `${path.join(tmp, "taken")} already exists and isn't a folder.` });
  });

  it("names the error code when the folder can't be created", async () => {
    const locked = path.join(tmp, "locked");
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o555);
    try {
      const res = await post({ parent: locked, name: "app" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: `Couldn't create ${path.join(locked, "app")} (EACCES).` });
      expect(settings.touchProject).not.toHaveBeenCalled();
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  it("leaves the code out when the error has none", async () => {
    const mkdir = vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => {
      throw new Error("odd");
    });
    try {
      expect(await (await post({ parent: tmp, name: "fresh" })).json()).toEqual({ error: `Couldn't create ${path.join(tmp, "fresh")}.` });
    } finally {
      mkdir.mockRestore();
    }
  });
});

describe("GET /skills/set", () => {
  it("returns the view for ?cwd=", async () => {
    vi.mocked(skillSetActions.skillSetView).mockReturnValueOnce({ seeded: true, rows: [] });
    const res = await skillSetRoute.GET(req("/skills/set?cwd=%2Fdev%2Fapp", { headers: READ }));
    expect(await res.json()).toEqual({ seeded: true, rows: [] });
    expect(skillSetActions.skillSetView).toHaveBeenLastCalledWith("/dev/app", undefined);
  });

  it("returns the view for a known card, using its cwd", async () => {
    cardStore.set("c1", { id: "c1", cwd: "/dev/app" });
    vi.mocked(skillSetActions.skillSetView).mockReturnValueOnce({ seeded: true, rows: [] });
    const res = await skillSetRoute.GET(req("/skills/set?card=c1", { headers: READ }));
    expect(await res.json()).toEqual({ seeded: true, rows: [] });
    expect(skillSetActions.skillSetView).toHaveBeenLastCalledWith("/dev/app", { id: "c1", cwd: "/dev/app" });
  });

  it("400s when neither cwd nor a known card is given", async () => {
    const noCwd = await skillSetRoute.GET(req("/skills/set", { headers: READ }));
    expect(noCwd.status).toBe(400);
    expect(await noCwd.json()).toEqual({ error: "Pass ?cwd= or a card that exists." });
    // ?card= with an unknown id falls back to ?cwd= and is still 400.
    const unknown = await skillSetRoute.GET(req("/skills/set?card=nope", { headers: READ }));
    expect(unknown.status).toBe(400);
    expect(skillSetActions.skillSetView).not.toHaveBeenCalled();
  });

  it("rejects a foreign host", async () => {
    const res = await skillSetRoute.GET(req("/skills/set?cwd=%2Fdev%2Fapp", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(skillSetActions.skillSetView).not.toHaveBeenCalled();
  });

  it("400s when skillSetView throws (fail()'s default status)", async () => {
    vi.mocked(skillSetActions.skillSetView).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const res = await skillSetRoute.GET(req("/skills/set?cwd=%2Fdev%2Fapp", { headers: READ }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "disk full" });
  });
});

describe("PUT /skills/set", () => {
  it("rejects a write without Weft's token", async () => {
    const res = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", headers: READ, body: { cwd: "/dev/app", name: "x", on: false } }));
    expect(res.status).toBe(403);
    expect(skillSetActions.setProjectSkill).not.toHaveBeenCalled();
  });

  it("changes the project's default set with { cwd, name, on }", async () => {
    vi.mocked(skillSetActions.setProjectSkill).mockReturnValueOnce(["quiet-skill"]);
    vi.mocked(skillSetActions.skillSetView).mockReturnValueOnce({ seeded: true, rows: [] });
    const res = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { cwd: "/dev/app", name: "quiet-skill", on: false } }));
    expect(res.status).toBe(200);
    expect(skillSetActions.setProjectSkill).toHaveBeenLastCalledWith("/dev/app", "quiet-skill", false);
    expect(skillSetActions.skillSetView).toHaveBeenLastCalledWith("/dev/app");
  });

  it("changes just one card with { card, name, on }", async () => {
    const card = { id: "c1", cwd: "/dev/app" };
    cardStore.set("c1", card);
    vi.mocked(skillSetActions.setCardSkill).mockResolvedValueOnce({ ...card, skillsOff: ["x"] } as unknown as Card);
    vi.mocked(skillSetActions.skillSetView).mockReturnValueOnce({ seeded: true, rows: [] });
    const res = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { card: "c1", name: "x", on: false } }));
    expect(res.status).toBe(200);
    expect(skillSetActions.setCardSkill).toHaveBeenLastCalledWith("c1", "x", false);
    expect(skillSetActions.skillSetView).toHaveBeenLastCalledWith("/dev/app", { id: "c1", cwd: "/dev/app", skillsOff: ["x"] });
  });

  it("404s when the card doesn't exist", async () => {
    vi.mocked(skillSetActions.setCardSkill).mockResolvedValueOnce(undefined);
    const res = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { card: "nope", name: "x", on: false } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such card." });
  });

  it("400s a body that isn't name+on, or a cwd that's missing or empty", async () => {
    const badName = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { cwd: "/x", on: true } }));
    expect(badName.status).toBe(400);
    expect(skillSetActions.setProjectSkill).not.toHaveBeenCalled();
    const badOn = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { cwd: "/x", name: "x", on: "yes" } }));
    expect(badOn.status).toBe(400);
    const noTarget = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { name: "x", on: true } }));
    expect(noTarget.status).toBe(400);
    const emptyCwd = await skillSetRoute.PUT(req("/skills/set", { method: "PUT", body: { cwd: "", name: "x", on: true } }));
    expect(emptyCwd.status).toBe(400);
  });
});
