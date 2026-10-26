import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillScan } from "./types";
// The error class is used as a type too (the casts below), and a dynamic import gives only the value.
import type { SkillInstallError as SkillInstallErrorType } from "./skill-install";

// A skill from skills.sh, from preview to install (lib/skill-install.ts). WEFT_DATA and HOME point at
// temp dirs before the imports, so nothing lands in the real ~/.weft or ~/.claude.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-install-"));
process.env.WEFT_DATA = path.join(root, "data");
process.env.HOME = path.join(root, "home");

vi.mock("./skill-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./skill-registry")>()),
  downloadSkill: vi.fn(),
}));

const { downloadSkill } = await import("./skill-registry");
const { installSkill, previewSkill, SkillInstallError } = await import("./skill-install");
const { storeSkill } = await import("./skill-cache");

const ID = "owner/repo/demo";
const HASH = "c".repeat(16);
const FILES = [
  { path: "SKILL.md", contents: "---\nname: demo\ndescription: A demo skill.\n---\n\n# demo\n" },
  { path: "LICENSE", contents: "MIT License\n\nPermission is hereby granted, free of charge\n" },
  { path: "scripts/run.sh", contents: "echo hi\n" },
];

const userSkillsDir = () => path.join(process.env.HOME as string, ".claude", "skills");

const scan = (over: Partial<SkillScan> = {}): SkillScan => ({
  verdict: "clean",
  findings: [],
  license: { spdx: "MIT", kind: "permissive" },
  hosts: [],
  files: 2,
  bytes: 100,
  ...over,
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeAll(() => {
  fs.mkdirSync(userSkillsDir(), { recursive: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // The kept copies and anything installed.
  fs.rmSync(path.join(process.env.WEFT_DATA as string), { recursive: true, force: true });
  fs.rmSync(userSkillsDir(), { recursive: true, force: true });
  fs.mkdirSync(userSkillsDir(), { recursive: true });
});

describe("previewSkill", () => {
  it("previews the skill skills.sh has now, with its files and scan", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const preview = await previewSkill(ID);
    expect(preview.id).toBe(ID);
    expect(preview.source).toBe("owner/repo");
    expect(preview.name).toBe("demo");
    expect(preview.description).toBe("A demo skill.");
    expect(preview.hash).toBe(HASH);
    // readFiles() lists the folder as the disk does: LICENSE, SKILL.md, scripts/run.sh.
    expect(preview.files).toEqual([
      { path: "LICENSE", bytes: FILES[1]!.contents.length },
      { path: "SKILL.md", bytes: FILES[0]!.contents.length },
      { path: "scripts/run.sh", bytes: FILES[2]!.contents.length },
    ]);
    expect(preview.scan.verdict).toBe("clean");
    expect(preview.review).toEqual({ status: "none" });
    expect(preview.installed).toBe(false);
    expect(preview.offline).toBeUndefined();
  });

  it("says it's offline and shows the copy it kept when skills.sh can't be reached", async () => {
    vi.mocked(downloadSkill).mockRejectedValueOnce(new Error("skills.sh answered 503."));
    // A copy kept from before.
    storeSkill(ID, HASH, FILES);
    const preview = await previewSkill(ID);
    expect(preview.offline).toBe(true);
    expect(preview.name).toBe("demo");
    expect(preview.hash).toBe(HASH);
    expect(preview.files.length).toBe(3);
  });

  it("rethrows when skills.sh fails and nothing is kept", async () => {
    vi.mocked(downloadSkill).mockRejectedValueOnce(new Error("skills.sh answered 503."));
    await expect(previewSkill(ID)).rejects.toThrow("skills.sh answered 503.");
  });

  it("marks a skill that's already installed", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    fs.mkdirSync(path.join(userSkillsDir(), "demo"), { recursive: true });
    fs.writeFileSync(path.join(userSkillsDir(), "demo", "SKILL.md"), "# demo\n");
    const preview = await previewSkill(ID);
    expect(preview.installed).toBe(true);
  });
});

describe("installSkill", () => {
  it("writes the skill into ~/.claude/skills with a note of where it came from", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const result = await installSkill(ID);
    const dir = path.join(userSkillsDir(), "demo");
    expect(result.name).toBe("demo");
    expect(result.dir).toBe(dir);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(FILES[0]!.contents);
    expect(fs.readFileSync(path.join(dir, "scripts", "run.sh"), "utf8")).toBe("echo hi\n");

    const source = JSON.parse(fs.readFileSync(path.join(dir, ".weft-source.json"), "utf8")) as {
      registry: string;
      id: string;
      hash: string;
      verdict: string;
      installedAt: string;
    };
    expect(source.registry).toBe("https://skills.sh");
    expect(source.id).toBe(ID);
    expect(source.hash).toBe(HASH);
    expect(source.verdict).toBe("clean");
    expect(typeof source.installedAt).toBe("string");
  });

  it("refuses a dangerous skill without force", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const danger = scan({ verdict: "danger" });
    // The scan of the copy Weft keeps is the dangerous one.
    const stored = storeSkill(ID, HASH, FILES);
    vi.spyOn(await import("./skill-cache"), "readStored");
    // The scan comes from the stored copy, so make the stored copy dangerous by patching its scan.json.
    const scanFile = path.join(stored.dir, "scan.json");
    fs.writeFileSync(scanFile, JSON.stringify(danger));
    await expect(installSkill(ID)).rejects.toThrow(SkillInstallError);
    expect(fs.existsSync(path.join(userSkillsDir(), "demo"))).toBe(false);
  });

  it("installs a dangerous skill when forced", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const stored = storeSkill(ID, HASH, FILES);
    fs.writeFileSync(path.join(stored.dir, "scan.json"), JSON.stringify(scan({ verdict: "danger" })));
    const result = await installSkill(ID, { force: true });
    expect(result.name).toBe("demo");
    expect(fs.existsSync(path.join(userSkillsDir(), "demo", "SKILL.md"))).toBe(true);
  });

  it("carries the scan on the error it throws for a dangerous skill", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const stored = storeSkill(ID, HASH, FILES);
    const danger = scan({ verdict: "danger" });
    fs.writeFileSync(path.join(stored.dir, "scan.json"), JSON.stringify(danger));
    const err = await installSkill(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillInstallError);
    expect((err as SkillInstallErrorType).status).toBe(409);
    expect((err as SkillInstallErrorType).scan?.verdict).toBe("danger");
  });

  it("refuses a skill whose AI review says unsafe", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const stored = storeSkill(ID, HASH, FILES);
    // A kept review that says unsafe, beside the copy.
    fs.writeFileSync(
      path.join(stored.dir, "review.json"),
      JSON.stringify({
        verdict: "unsafe",
        summary: "s",
        whatItDoes: "w",
        concerns: [],
        falsePositives: [],
        dataFlow: "d",
        license: "l",
        recommendation: "r",
        model: "sonnet",
        reviewedAt: "2026-10-26T12:00:00.000Z",
      }),
    );
    const err = await installSkill(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillInstallError);
    expect((err as SkillInstallErrorType).status).toBe(409);
    expect(fs.existsSync(path.join(userSkillsDir(), "demo"))).toBe(false);
  });

  it("installs a skill whose AI review says unsafe when forced", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const stored = storeSkill(ID, HASH, FILES);
    fs.writeFileSync(
      path.join(stored.dir, "review.json"),
      JSON.stringify({
        verdict: "unsafe",
        summary: "s",
        whatItDoes: "w",
        concerns: [],
        falsePositives: [],
        dataFlow: "d",
        license: "l",
        recommendation: "r",
        model: "sonnet",
        reviewedAt: "2026-10-26T12:00:00.000Z",
      }),
    );
    const result = await installSkill(ID, { force: true });
    expect(result.name).toBe("demo");
  });

  it("refuses when a skill of that name is already there", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    fs.mkdirSync(path.join(userSkillsDir(), "demo"), { recursive: true });
    const err = await installSkill(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillInstallError);
    expect((err as SkillInstallErrorType).status).toBe(409);
    expect((err as SkillInstallErrorType).message).toBe("You already have a skill named demo.");
  });

  it("cleans up the temporary folder when the copy fails", async () => {
    vi.mocked(downloadSkill).mockResolvedValueOnce({ files: FILES, hash: HASH });
    const cp = vi.spyOn(fs, "cpSync").mockImplementationOnce(() => {
      throw new Error("ENOSPC");
    });
    try {
      await expect(installSkill(ID)).rejects.toThrow("ENOSPC");
    } finally {
      cp.mockRestore();
    }
    // Nothing half-written is left behind: no dot-named temp folder, no skill.
    const left = fs.readdirSync(userSkillsDir());
    expect(left).toEqual([]);
  });
});
