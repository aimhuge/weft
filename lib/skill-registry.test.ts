import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// listSkills() is what says which skills are already installed, so the registry only has to be mocked.
const skills = vi.hoisted(() => ({ installed: [] as { name: string; description: string; source: string }[] }));
vi.mock("./skills", () => ({ listSkills: (cwd?: string) => (cwd === "bad-cwd" ? [] : skills.installed) }));

const { downloadSkill, filesHash, safeRelPath, searchSkills, skillMeta } = await import("./skill-registry");

type FetchArgs = [string, { signal?: AbortSignal; headers?: Record<string, string> }];

const okJson = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const errJson = (status: number) => ({ ok: false, status, json: () => Promise.resolve({}) });

let calls: FetchArgs[] = [];

const fetchMock = (impl: (url: string) => unknown) => {
  const fn = vi.fn((url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    calls.push([url, init ?? {}]);
    return Promise.resolve(impl(url));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};

beforeEach(() => {
  calls = [];
  skills.installed = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchSkills", () => {
  it("returns nothing for a query shorter than two characters, without asking the registry", async () => {
    const fn = fetchMock(() => okJson({ skills: [] }));
    expect(await searchSkills("a")).toEqual([]);
    expect(await searchSkills("  ")).toEqual([]);
    expect(await searchSkills("")).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("asks the registry for the hits and maps them", async () => {
    const fn = fetchMock(() =>
      okJson({
        skills: [
          { id: "owner/repo/skill", name: "skill", source: "owner/repo", installs: 42 },
          { id: "other/repo/thing", skillId: "thing", source: "other/repo", installs: 7 },
        ],
      }),
    );
    const out = await searchSkills("skill");
    expect(out).toEqual([
      { id: "owner/repo/skill", source: "owner/repo", name: "skill", installs: 42, installed: false },
      { id: "other/repo/thing", source: "other/repo", name: "thing", installs: 7, installed: false },
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = calls[0]!;
    expect(url).toContain("/api/search?q=skill");
    expect(url).toContain("limit=12");
    expect(init.headers?.accept).toBe("application/json");
  });

  it("passes the limit through and encodes the query", async () => {
    fetchMock(() => okJson({ skills: [] }));
    await searchSkills("a b", "/tmp", 3);
    expect(calls[0]![0]).toContain("/api/search?q=a%20b");
    expect(calls[0]![0]).toContain("limit=3");
  });

  it("drops hits whose id isn't a skills.sh id", async () => {
    fetchMock(() =>
      okJson({
        skills: [
          { id: "not-an-id", name: "bad", source: "x" },
          { id: "owner/repo/skill", name: "good", source: "owner/repo" },
          { id: "owner/repo", name: "too-short", source: "owner/repo" },
          { id: "owner/repo/a/b", name: "too-long", source: "owner/repo" },
          "not an object",
        ],
      }),
    );
    const out = await searchSkills("skill");
    expect(out.map((s) => s.id)).toEqual(["owner/repo/skill"]);
  });

  it("marks a hit installed when a skill of that name is already in the library", async () => {
    skills.installed = [{ name: "skill", description: "d", source: "user" }];
    fetchMock(() => okJson({ skills: [{ id: "owner/repo/skill", name: "skill", source: "owner/repo" }] }));
    const [hit] = await searchSkills("skill");
    expect(hit?.installed).toBe(true);
  });

  it("falls back to zero installs and an empty source when the registry leaves them out", async () => {
    fetchMock(() => okJson({ skills: [{ id: "owner/repo/skill", name: "skill" }] }));
    const [hit] = await searchSkills("skill");
    expect(hit).toEqual({ id: "owner/repo/skill", source: "", name: "skill", installs: 0, installed: false });
  });

  it("returns nothing when the registry answers with something that isn't a list of hits", async () => {
    fetchMock(() => okJson({ skills: "nope" }));
    expect(await searchSkills("skill")).toEqual([]);
    fetchMock(() => okJson([1, 2, 3]));
    expect(await searchSkills("skill")).toEqual([]);
    fetchMock(() => okJson(null));
    expect(await searchSkills("skill")).toEqual([]);
  });

  it("throws when the registry answers with an error status", async () => {
    fetchMock(() => errJson(503));
    await expect(searchSkills("skill")).rejects.toThrow("skills.sh answered 503.");
  });
});

describe("safeRelPath", () => {
  it("keeps a plain relative path", () => {
    expect(safeRelPath("SKILL.md")).toBe("SKILL.md");
    expect(safeRelPath("scripts/run.py")).toBe("scripts/run.py");
  });

  it("turns backslashes into forward slashes", () => {
    expect(safeRelPath("scripts\\run.py")).toBe("scripts/run.py");
  });

  it("normalises a path that steps through its own folder", () => {
    expect(safeRelPath("scripts/../SKILL.md")).toBe("SKILL.md");
  });

  it("refuses an empty path", () => {
    expect(safeRelPath("")).toBeNull();
  });

  it("refuses a path with a null byte", () => {
    expect(safeRelPath("scripts/\0run.py")).toBeNull();
  });

  it("refuses an absolute path", () => {
    expect(safeRelPath("/etc/passwd")).toBeNull();
    expect(safeRelPath("/SKILL.md")).toBeNull();
  });

  it("refuses a Windows drive path", () => {
    expect(safeRelPath("C:/Windows/System32/cmd.exe")).toBeNull();
    expect(safeRelPath("c:evil")).toBeNull();
  });

  it("refuses a path that climbs out of the folder", () => {
    expect(safeRelPath("..")).toBeNull();
    expect(safeRelPath("../outside.md")).toBeNull();
    expect(safeRelPath("../../outside.md")).toBeNull();
    expect(safeRelPath("scripts/../../outside.md")).toBeNull();
  });

  it("refuses the folder itself", () => {
    expect(safeRelPath(".")).toBeNull();
  });
});

describe("filesHash", () => {
  it("is the same for the same files in any order", () => {
    const a = { path: "SKILL.md", contents: "one" };
    const b = { path: "scripts/run.py", contents: "two" };
    expect(filesHash([a, b])).toBe(filesHash([b, a]));
  });

  it("changes when a file's contents change", () => {
    const hash = filesHash([{ path: "SKILL.md", contents: "one" }]);
    expect(filesHash([{ path: "SKILL.md", contents: "two" }])).not.toBe(hash);
  });

  it("changes when a file's path changes", () => {
    const hash = filesHash([{ path: "SKILL.md", contents: "one" }]);
    expect(filesHash([{ path: "other.md", contents: "one" }])).not.toBe(hash);
  });

  it("is a sha256 hex digest", () => {
    expect(filesHash([])).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("downloadSkill", () => {
  it("refuses an id that isn't a skills.sh id", async () => {
    const fn = fetchMock(() => okJson({ files: [] }));
    await expect(downloadSkill("owner/repo")).rejects.toThrow("Not a skills.sh skill id.");
    await expect(downloadSkill("owner/repo/skill/extra")).rejects.toThrow("Not a skills.sh skill id.");
    expect(fn).not.toHaveBeenCalled();
  });

  it("downloads the files and uses the registry's hash", async () => {
    const fn = fetchMock(() =>
      okJson({
        hash: "abcdef0123456789abcdef0123456789",
        files: [
          { path: "SKILL.md", contents: "# skill" },
          { path: "scripts/run.py", contents: "print(1)" },
        ],
      }),
    );
    const out = await downloadSkill("owner/repo/skill");
    expect(out.files).toEqual([
      { path: "SKILL.md", contents: "# skill" },
      { path: "scripts/run.py", contents: "print(1)" },
    ]);
    expect(out.hash).toBe("abcdef0123456789abcdef0123456789");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0]![0]).toContain("/api/download/owner/repo/skill");
  });

  it("encodes each part of the id in the download url", async () => {
    fetchMock(() => okJson({ files: [{ path: "SKILL.md", contents: "#" }] }));
    await downloadSkill("own.er/re-po/skill");
    expect(calls[0]![0]).toContain("/api/download/own.er/re-po/skill");
  });

  it("throws when the skill has no SKILL.md", async () => {
    fetchMock(() => okJson({ files: [{ path: "README.md", contents: "#" }] }));
    await expect(downloadSkill("owner/repo/skill")).rejects.toThrow("That skill has no SKILL.md.");
  });

  it("accepts a SKILL.md in any case", async () => {
    fetchMock(() => okJson({ files: [{ path: "skill.md", contents: "#" }] }));
    const out = await downloadSkill("owner/repo/skill");
    expect(out.files).toHaveLength(1);
  });

  it("throws when the skill has too many files", async () => {
    const files = [{ path: "SKILL.md", contents: "#" }];
    for (let i = 0; i < 300; i++) files.push({ path: `f${i}.txt`, contents: "x" });
    fetchMock(() => okJson({ files }));
    await expect(downloadSkill("owner/repo/skill")).rejects.toThrow("That skill has 301 files; Weft takes up to 300.");
  });

  it("throws when the skill is over 5 MB", async () => {
    fetchMock(() => okJson({ files: [{ path: "SKILL.md", contents: "x".repeat(5_000_001) }] }));
    await expect(downloadSkill("owner/repo/skill")).rejects.toThrow("That skill is over 5 MB.");
  });

  it("throws when a file points outside the skill's folder", async () => {
    fetchMock(() =>
      okJson({
        files: [
          { path: "SKILL.md", contents: "#" },
          { path: "../outside.md", contents: "x" },
        ],
      }),
    );
    await expect(downloadSkill("owner/repo/skill")).rejects.toThrow("That skill has a file outside its folder: ../outside.md");
  });

  it("falls back to a hash of the files when the registry sends none or sends nonsense", async () => {
    fetchMock(() => okJson({ files: [{ path: "SKILL.md", contents: "#" }] }));
    const none = await downloadSkill("owner/repo/skill");
    expect(none.hash).toBe(filesHash(none.files));

    fetchMock(() => okJson({ hash: "not-a-hash", files: [{ path: "SKILL.md", contents: "#" }] }));
    const bad = await downloadSkill("owner/repo/skill");
    expect(bad.hash).toBe(filesHash(bad.files));

    fetchMock(() => okJson({ hash: 42, files: [{ path: "SKILL.md", contents: "#" }] }));
    const notAString = await downloadSkill("owner/repo/skill");
    expect(notAString.hash).toBe(filesHash(notAString.files));
  });

  it("throws when the registry answers with an error status", async () => {
    fetchMock(() => errJson(404));
    await expect(downloadSkill("owner/repo/skill")).rejects.toThrow("skills.sh answered 404.");
  });

  it("reads an empty file list as no files", async () => {
    fetchMock(() => okJson({ files: "nope" }));
    await expect(downloadSkill("owner/repo/skill")).rejects.toThrow("That skill has no SKILL.md.");
  });
});

describe("skillMeta", () => {
  const skillMd = (body: string) => [{ path: "SKILL.md", contents: body }];

  it("reads the name and description from the frontmatter", () => {
    const out = skillMeta(skillMd("---\nname: deployer\ndescription: Deploys things.\n---\n\n# Deployer\n"), "fallback");
    expect(out).toEqual({ name: "deployer", description: "Deploys things." });
  });

  it("takes the quotes off a quoted value", () => {
    const out = skillMeta(skillMd('---\nname: "deployer"\ndescription: \'Deploys things.\'\n---\n'), "fallback");
    expect(out).toEqual({ name: "deployer", description: "Deploys things." });
  });

  it("falls back to the given name when the frontmatter's isn't usable", () => {
    expect(skillMeta(skillMd("---\nname: not a name!\ndescription: d\n---\n"), "fallback").name).toBe("fallback");
    expect(skillMeta(skillMd("---\ndescription: d\n---\n"), "fallback").name).toBe("fallback");
    expect(skillMeta(skillMd("no frontmatter here"), "fallback").name).toBe("fallback");
  });

  it("has an empty description when there is none", () => {
    expect(skillMeta(skillMd("---\nname: deployer\n---\n"), "fallback").description).toBe("");
    expect(skillMeta([], "fallback")).toEqual({ name: "fallback", description: "" });
  });

  it("truncates a long description to 400 characters with an ellipsis", () => {
    const long = "x".repeat(500);
    const out = skillMeta(skillMd(`---\nname: deployer\ndescription: ${long}\n---\n`), "fallback");
    expect(out.description).toHaveLength(400);
    expect(out.description.endsWith("…")).toBe(true);
  });

  it("keeps a description of exactly 400 characters as it is", () => {
    const exact = "y".repeat(400);
    const out = skillMeta(skillMd(`---\nname: deployer\ndescription: ${exact}\n---\n`), "fallback");
    expect(out.description).toBe(exact);
  });
});
