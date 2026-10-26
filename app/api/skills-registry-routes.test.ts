import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillScan } from "@/lib/types";

// The four skills-registry routes: the search in the ✦ drawer, a skills.sh skill's preview and install,
// a skill's AI review, and the static scan of the library. Every lib they call is mocked; the skill id
// regex and the install error class stay real, so a bad id and a dangerous skill behave as they do in the app.

vi.mock("next/server", () => ({ connection: async () => {} }));

const { searchSkills, previewSkill, installSkill, pluginInstalls, scanLibrary, localTarget, remoteTarget, reviewState, startReview } = vi.hoisted(() => ({
  searchSkills: vi.fn(),
  previewSkill: vi.fn(),
  installSkill: vi.fn(),
  pluginInstalls: vi.fn(),
  scanLibrary: vi.fn(),
  localTarget: vi.fn(),
  remoteTarget: vi.fn(),
  reviewState: vi.fn(),
  startReview: vi.fn(),
}));

vi.mock("@/lib/skill-registry", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/skill-registry")>()),
  searchSkills,
}));
vi.mock("@/lib/skill-install", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/skill-install")>()),
  previewSkill,
  installSkill,
}));
vi.mock("@/lib/skill-review", () => ({ localTarget, remoteTarget, reviewState, startReview }));
vi.mock("@/lib/skill-library", () => ({ pluginInstalls }));
vi.mock("@/lib/skill-scan-library", () => ({ scanLibrary }));

const searchRoute = await import("./skills/search/route");
const remoteRoute = await import("./skills/remote/route");
const reviewRoute = await import("./skills/review/route");
const scanRoute = await import("./skills/scan/route");
const { SkillInstallError } = await import("@/lib/skill-install");

const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = READ }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SCAN: SkillScan = { verdict: "clean", findings: [], license: { spdx: null, kind: "none" }, hosts: [], files: 1, bytes: 10 };
const PREVIEW = { id: "owner/repo/skill", source: "owner/repo", name: "skill", description: "d", hash: "abc", files: [{ path: "SKILL.md", bytes: 10 }], scan: SCAN, review: { status: "none" }, installed: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /skills/search", () => {
  it("searches with ?q= and ?cwd=", async () => {
    searchSkills.mockResolvedValueOnce([{ id: "owner/repo/skill", source: "owner/repo", name: "skill", installs: 3, installed: true }]);
    const res = await searchRoute.GET(req("/skills/search?q=sp%26l&cwd=%2Fdev%2Fapp"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skills: [{ id: "owner/repo/skill", source: "owner/repo", name: "skill", installs: 3, installed: true }] });
    expect(searchSkills).toHaveBeenLastCalledWith("sp&l", "/dev/app");
  });

  it("searches with an empty query and no folder", async () => {
    searchSkills.mockResolvedValueOnce([]);
    const res = await searchRoute.GET(req("/skills/search"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skills: [] });
    expect(searchSkills).toHaveBeenLastCalledWith("", undefined);
  });

  it("502s when the search fails", async () => {
    searchSkills.mockRejectedValueOnce(new Error("skills.sh is down"));
    const res = await searchRoute.GET(req("/skills/search?q=test"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "skills.sh is down" });
  });

  it("rejects a foreign host and searches nothing", async () => {
    const res = await searchRoute.GET(req("/skills/search?q=test", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(searchSkills).not.toHaveBeenCalled();
  });
});

describe("GET /skills/remote", () => {
  it("previews the skill for ?id= and ?cwd=", async () => {
    previewSkill.mockResolvedValueOnce(PREVIEW);
    const res = await remoteRoute.GET(req("/skills/remote?id=owner%2Frepo%2Fskill&cwd=%2Fdev%2Fapp"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PREVIEW);
    expect(previewSkill).toHaveBeenLastCalledWith("owner/repo/skill", "/dev/app");
  });

  it("previews without a folder", async () => {
    previewSkill.mockResolvedValueOnce(PREVIEW);
    await remoteRoute.GET(req("/skills/remote?id=owner%2Frepo%2Fskill"));
    expect(previewSkill).toHaveBeenLastCalledWith("owner/repo/skill", undefined);
  });

  it("400s an id that isn't owner/repo/skill, or none at all", async () => {
    const bad = await remoteRoute.GET(req("/skills/remote?id=nope"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Pass ?id=owner/repo/skill." });
    const none = await remoteRoute.GET(req("/skills/remote"));
    expect(none.status).toBe(400);
    expect(previewSkill).not.toHaveBeenCalled();
  });

  it("502s when the preview fails", async () => {
    previewSkill.mockRejectedValueOnce(new Error("skills.sh answered 500."));
    const res = await remoteRoute.GET(req("/skills/remote?id=owner%2Frepo%2Fskill"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "skills.sh answered 500." });
  });

  it("rejects a foreign host and previews nothing", async () => {
    const res = await remoteRoute.GET(req("/skills/remote?id=owner%2Frepo%2Fskill", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(previewSkill).not.toHaveBeenCalled();
  });
});

describe("POST /skills/remote", () => {
  const post = (body: unknown, headers: Record<string, string> = WRITE) => remoteRoute.POST(req("/skills/remote", { method: "POST", body, headers }));

  it("installs the skill and answers with its name and scan", async () => {
    installSkill.mockResolvedValueOnce({ name: "skill", dir: "/home/.claude/skills/skill", scan: SCAN });
    const res = await post({ id: "owner/repo/skill" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "skill", scan: SCAN });
    expect(installSkill).toHaveBeenLastCalledWith("owner/repo/skill", { force: false });
  });

  it("passes force only when the body says force: true", async () => {
    installSkill.mockResolvedValue({ name: "skill", dir: "/d", scan: SCAN });
    await post({ id: "owner/repo/skill", force: true });
    expect(installSkill).toHaveBeenLastCalledWith("owner/repo/skill", { force: true });
    await post({ id: "owner/repo/skill", force: "yes" });
    expect(installSkill).toHaveBeenLastCalledWith("owner/repo/skill", { force: false });
    await post({ id: "owner/repo/skill", force: 1 });
    expect(installSkill).toHaveBeenLastCalledWith("owner/repo/skill", { force: false });
  });

  it("400s an id that is missing or isn't owner/repo/skill", async () => {
    const missing = await post({});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "id is required." });
    const notString = await post({ id: 42 });
    expect(notString.status).toBe(400);
    const bad = await post({ id: "nope" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "id is required." });
    expect(installSkill).not.toHaveBeenCalled();
  });

  it("answers a SkillInstallError with its status and the scan", async () => {
    installSkill.mockRejectedValueOnce(new SkillInstallError("Weft's scan found something dangerous in this skill.", 409, SCAN));
    const res = await post({ id: "owner/repo/skill" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Weft's scan found something dangerous in this skill.", scan: SCAN });
  });

  it("400s anything else that goes wrong", async () => {
    installSkill.mockRejectedValueOnce(new Error("EACCES"));
    const res = await post({ id: "owner/repo/skill" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "EACCES" });
  });

  it("rejects a write without Weft's token and installs nothing", async () => {
    const res = await post({ id: "owner/repo/skill" }, READ);
    expect(res.status).toBe(403);
    expect(installSkill).not.toHaveBeenCalled();
  });
});

describe("GET /skills/review", () => {
  const TARGET = { key: "remote:owner/repo/skill@abc", name: "skill", source: "skills.sh", filesDir: "/f", storeDir: "/s", scan: SCAN };

  it("reads the state of a remote skill by id, with and without a hash", async () => {
    remoteTarget.mockReturnValue(TARGET);
    reviewState.mockReturnValue({ status: "none" });
    const res = await reviewRoute.GET(req("/skills/review?id=owner%2Frepo%2Fskill"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "none" });
    expect(remoteTarget).toHaveBeenLastCalledWith("owner/repo/skill", undefined);
    await reviewRoute.GET(req("/skills/review?id=owner%2Frepo%2Fskill&hash=abc"));
    expect(remoteTarget).toHaveBeenLastCalledWith("owner/repo/skill", "abc");
    expect(reviewState).toHaveBeenLastCalledWith(TARGET);
  });

  it("reads the state of a skill you have, by folder and name", async () => {
    localTarget.mockReturnValue(TARGET);
    reviewState.mockReturnValue({ status: "running", page: "/p.html" });
    const res = await reviewRoute.GET(req("/skills/review?cwd=%2Fdev%2Fapp&name=skill"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", page: "/p.html" });
    expect(localTarget).toHaveBeenLastCalledWith("/dev/app", "skill", undefined);
  });

  it("reads the state of a plugin by its id, and of one that isn't installed", async () => {
    localTarget.mockReturnValue(TARGET);
    reviewState.mockReturnValue({ status: "none" });
    pluginInstalls.mockReturnValue([{ id: "pack@market", installPath: "/plugins/pack" }]);
    await reviewRoute.GET(req("/skills/review?name=pack%40market"));
    expect(localTarget).toHaveBeenLastCalledWith(undefined, "pack@market", "/plugins/pack");
    pluginInstalls.mockReturnValue([{ id: "other@market", installPath: "/plugins/other" }]);
    await reviewRoute.GET(req("/skills/review?name=pack%40market"));
    expect(localTarget).toHaveBeenLastCalledWith(undefined, "pack@market", undefined);
  });

  it("404s without a name, or with an empty one", async () => {
    const none = await reviewRoute.GET(req("/skills/review"));
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: "Weft has no copy of that skill. Preview it first." });
    const empty = await reviewRoute.GET(req("/skills/review?name="));
    expect(empty.status).toBe(404);
    expect(localTarget).not.toHaveBeenCalled();
  });

  it("400s when reading the state throws", async () => {
    remoteTarget.mockReturnValue(TARGET);
    reviewState.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const res = await reviewRoute.GET(req("/skills/review?id=owner%2Frepo%2Fskill"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "disk full" });
  });

  it("rejects a foreign host and reads nothing", async () => {
    const res = await reviewRoute.GET(req("/skills/review?id=owner%2Frepo%2Fskill", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(reviewState).not.toHaveBeenCalled();
  });
});

describe("POST /skills/review", () => {
  const TARGET = { key: "remote:owner/repo/skill@abc", name: "skill", source: "skills.sh", filesDir: "/f", storeDir: "/s", scan: SCAN };
  const post = (body: unknown, headers: Record<string, string> = WRITE) => reviewRoute.POST(req("/skills/review", { method: "POST", body, headers }));

  it("starts a review of a remote skill, with and without a hash", async () => {
    remoteTarget.mockReturnValue(TARGET);
    startReview.mockReturnValue({ status: "running", page: "/p.html" });
    const res = await post({ id: "owner/repo/skill" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", page: "/p.html" });
    expect(remoteTarget).toHaveBeenLastCalledWith("owner/repo/skill", undefined);
    await post({ id: "owner/repo/skill", hash: "abc" });
    expect(remoteTarget).toHaveBeenLastCalledWith("owner/repo/skill", "abc");
    expect(startReview).toHaveBeenLastCalledWith(TARGET);
  });

  it("starts a review of a skill you have, by folder and name", async () => {
    localTarget.mockReturnValue(TARGET);
    startReview.mockReturnValue({ status: "running", page: "/p.html" });
    const res = await post({ cwd: "/dev/app", name: "skill" });
    expect(res.status).toBe(200);
    expect(localTarget).toHaveBeenLastCalledWith("/dev/app", "skill", undefined);
  });

  it("starts a review of a plugin by its id, and of one that isn't installed", async () => {
    localTarget.mockReturnValue(TARGET);
    startReview.mockReturnValue({ status: "running", page: "/p.html" });
    pluginInstalls.mockReturnValue([{ id: "pack@market", installPath: "/plugins/pack" }]);
    await post({ name: "pack@market" });
    expect(localTarget).toHaveBeenLastCalledWith(undefined, "pack@market", "/plugins/pack");
    pluginInstalls.mockReturnValue([{ id: "other@market", installPath: "/plugins/other" }]);
    await post({ name: "pack@market" });
    expect(localTarget).toHaveBeenLastCalledWith(undefined, "pack@market", undefined);
  });

  it("404s without a name, or with an empty one", async () => {
    const none = await post({});
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: "Weft has no copy of that skill. Preview it first." });
    const empty = await post({ name: "" });
    expect(empty.status).toBe(404);
    expect(startReview).not.toHaveBeenCalled();
  });

  it("400s when starting the review throws", async () => {
    remoteTarget.mockReturnValue(TARGET);
    startReview.mockImplementationOnce(() => {
      throw new Error("no agent");
    });
    const res = await post({ id: "owner/repo/skill" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no agent" });
  });

  it("rejects a write without Weft's token and starts nothing", async () => {
    const res = await post({ id: "owner/repo/skill" }, READ);
    expect(res.status).toBe(403);
    expect(startReview).not.toHaveBeenCalled();
  });
});

describe("GET /skills/scan", () => {
  it("scans the library in ?cwd=", async () => {
    scanLibrary.mockReturnValueOnce({ skill: SCAN });
    const res = await scanRoute.GET(req("/skills/scan?cwd=%2Fdev%2Fapp"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scans: { skill: SCAN } });
    expect(scanLibrary).toHaveBeenLastCalledWith("/dev/app");
  });

  it("scans without a folder", async () => {
    scanLibrary.mockReturnValueOnce({});
    const res = await scanRoute.GET(req("/skills/scan"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scans: {} });
    expect(scanLibrary).toHaveBeenLastCalledWith(undefined);
  });

  it("400s when the scan throws", async () => {
    scanLibrary.mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    const res = await scanRoute.GET(req("/skills/scan"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "EACCES" });
  });

  it("rejects a foreign host and scans nothing", async () => {
    const res = await scanRoute.GET(req("/skills/scan", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(scanLibrary).not.toHaveBeenCalled();
  });
});
