import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DATA_DIR is read from WEFT_DATA when lib/store.ts loads, so the temp dir has to be set before the import.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-cache-"));
process.env.WEFT_DATA = dataDir;

const { CACHE_DIR, entryDir, latestStored, readFiles, readReview, readStored, storeSkill, writeReview } = await import("./skill-cache");

const HASH = "abcdef0123456789";
const HASH2 = "fedcba9876543210";
const ID = "owner/repo/skill";

const clearCache = () => fs.rmSync(CACHE_DIR, { recursive: true, force: true });

const files = [
  { path: "SKILL.md", contents: "---\nname: deployer\ndescription: Deploys things.\n---\n\n# Deployer\n" },
  { path: "scripts/run.py", contents: "print(1)\n" },
];

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => clearCache());

afterEach(() => {
  vi.restoreAllMocks();
  clearCache();
});

describe("entryDir", () => {
  it("puts the skill under the cache, by owner, repo, skill and hash", () => {
    expect(entryDir(ID, HASH)).toBe(path.join(CACHE_DIR, "owner", "repo", "skill", HASH));
  });

  it("throws when the hash isn't a content hash", () => {
    expect(() => entryDir(ID, "nope")).toThrow("Not a content hash.");
    expect(() => entryDir(ID, "")).toThrow("Not a content hash.");
    expect(() => entryDir(ID, "ABCDEF0123456789")).toThrow("Not a content hash.");
    expect(() => entryDir(ID, "abc")).toThrow("Not a content hash.");
  });

  it("accepts a hash of 16 to 128 hex characters", () => {
    expect(() => entryDir(ID, "a".repeat(16))).not.toThrow();
    expect(() => entryDir(ID, "a".repeat(128))).not.toThrow();
  });

  it("throws when the id isn't three parts", () => {
    expect(() => entryDir("owner/repo", HASH)).toThrow("Not a skills.sh skill id.");
    expect(() => entryDir("owner/repo/skill/extra", HASH)).toThrow("Not a skills.sh skill id.");
    expect(() => entryDir("owner", HASH)).toThrow("Not a skills.sh skill id.");
  });

  it("throws when a part of the id isn't safe", () => {
    expect(() => entryDir("own er/repo/skill", HASH)).toThrow("Not a skills.sh skill id.");
    expect(() => entryDir("owner/repo/..", HASH)).toThrow("Not a skills.sh skill id.");
    expect(() => entryDir("owner/./skill", HASH)).toThrow("Not a skills.sh skill id.");
    expect(() => entryDir("../repo/skill", HASH)).toThrow("Not a skills.sh skill id.");
  });

  it("replaces a colon in a part with an underscore", () => {
    expect(entryDir("owner/repo/skill:1", HASH)).toBe(path.join(CACHE_DIR, "owner", "repo", "skill_1", HASH));
    expect(entryDir("owner:1/repo/skill", HASH)).toBe(path.join(CACHE_DIR, "owner_1", "repo", "skill", HASH));
  });
});

describe("storeSkill", () => {
  it("writes the files, the meta and the scan", () => {
    const stored = storeSkill(ID, HASH, files);
    expect(stored.dir).toBe(entryDir(ID, HASH));
    expect(stored.filesDir).toBe(path.join(stored.dir, "files"));
    expect(fs.readFileSync(path.join(stored.filesDir, "SKILL.md"), "utf8")).toBe(files[0]!.contents);
    expect(fs.readFileSync(path.join(stored.filesDir, "scripts", "run.py"), "utf8")).toBe(files[1]!.contents);
    expect(stored.meta).toMatchObject({ id: ID, hash: HASH, name: "deployer", description: "Deploys things." });
    expect(stored.meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored.scan.files).toBe(2);
    expect(stored.scan.bytes).toBe(files.reduce((n, f) => n + f.contents.length, 0));
    expect(fs.existsSync(path.join(stored.dir, "scan.json"))).toBe(true);
    expect(fs.existsSync(path.join(stored.dir, "meta.json"))).toBe(true);
  });

  it("returns the copy it already keeps on a second call, without rewriting it", () => {
    const first = storeSkill(ID, HASH, files);
    const metaFile = path.join(first.dir, "meta.json");
    const scanFile = path.join(first.dir, "scan.json");
    const before = fs.statSync(metaFile).mtimeMs;
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    const second = storeSkill(ID, HASH, files);
    expect(second.meta.fetchedAt).toBe(first.meta.fetchedAt);
    expect(second.meta).toEqual(first.meta);
    expect(second.scan).toEqual(first.scan);
    expect(fs.statSync(metaFile).mtimeMs).toBe(before);
    expect(fs.existsSync(scanFile)).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("skips a file whose path won't stay in the folder", () => {
    const stored = storeSkill(ID, HASH, [...files, { path: "../outside.md", contents: "x" }]);
    expect(fs.existsSync(path.join(stored.dir, "files", "outside.md"))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(stored.filesDir), "outside.md"))).toBe(false);
  });

  it("skips a file whose path normalises away to nothing", () => {
    const stored = storeSkill(ID, HASH, [...files, { path: ".", contents: "x" }]);
    expect(stored.meta.id).toBe(ID);
    expect(fs.readdirSync(stored.filesDir).sort()).toEqual(["SKILL.md", "scripts"]);
  });

  it("uses the skill id's last part as the name when the frontmatter has none", () => {
    const stored = storeSkill(ID, HASH, [{ path: "SKILL.md", contents: "# no frontmatter\n" }]);
    expect(stored.meta.name).toBe("skill");
  });
});

describe("readStored", () => {
  it("returns nothing when there's no meta", () => {
    expect(readStored(ID, HASH)).toBeUndefined();
  });

  it("reads the copy back with its meta and scan", () => {
    const stored = storeSkill(ID, HASH, files);
    const read = readStored(ID, HASH);
    expect(read?.meta).toEqual(stored.meta);
    expect(read?.scan).toEqual(stored.scan);
    expect(read?.dir).toBe(stored.dir);
  });

  it("scans the files when the scan file is missing", () => {
    const stored = storeSkill(ID, HASH, files);
    fs.rmSync(path.join(stored.dir, "scan.json"));
    const read = readStored(ID, HASH);
    expect(read?.scan.files).toBe(2);
    expect(read?.scan.bytes).toBe(stored.scan.bytes);
  });

  it("ignores a broken meta file", () => {
    const dir = entryDir(ID, HASH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), "{nope");
    expect(readStored(ID, HASH)).toBeUndefined();
  });
});

describe("latestStored", () => {
  it("returns nothing when nothing is kept", () => {
    expect(latestStored(ID)).toBeUndefined();
  });

  it("picks the newest copy", () => {
    const old = storeSkill(ID, HASH, files);
    const recent = storeSkill(ID, HASH2, files);
    // Make the first copy the older one.
    const metaFile = path.join(old.dir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { fetchedAt: string };
    meta.fetchedAt = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(metaFile, JSON.stringify(meta));

    const latest = latestStored(ID);
    expect(latest?.dir).toBe(recent.dir);
    expect(latest?.meta.fetchedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("ignores folders in the cache that aren't content hashes", () => {
    storeSkill(ID, HASH, files);
    fs.mkdirSync(path.join(CACHE_DIR, "owner", "repo", "skill", "not-a-hash"), { recursive: true });
    expect(latestStored(ID)?.meta.hash).toBe(HASH);
  });
});

describe("readFiles", () => {
  it("reads a folder recursively, with paths relative to it", () => {
    const stored = storeSkill(ID, HASH, files);
    const read = readFiles(stored.filesDir);
    expect(read).toEqual(files);
  });

  it("returns nothing for a folder that isn't there", () => {
    expect(readFiles(path.join(dataDir, "missing"))).toEqual([]);
  });

  it("reads from a subfolder when given a relative path", () => {
    const stored = storeSkill(ID, HASH, files);
    expect(readFiles(stored.filesDir, "scripts")).toEqual([{ path: "scripts/run.py", contents: "print(1)\n" }]);
  });

  it("skips anything that isn't a file or a folder", () => {
    const dir = path.join(dataDir, "odd");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    fs.symlinkSync(path.join(dir, "a.txt"), path.join(dir, "link.txt"));
    const read = readFiles(dir);
    expect(read).toEqual([{ path: "a.txt", contents: "a" }]);
  });
});

describe("readReview and writeReview", () => {
  it("writes a review and reads it back", () => {
    const stored = storeSkill(ID, HASH, files);
    const review = {
      verdict: "safe" as const,
      summary: "s",
      whatItDoes: "w",
      concerns: [],
      falsePositives: [],
      dataFlow: "Nothing leaves the machine.",
      license: "MIT.",
      recommendation: "install",
      model: "sonnet",
      reviewedAt: "2026-10-26T00:00:00.000Z",
    };
    writeReview(stored.dir, review);
    expect(readReview(stored.dir)).toEqual(review);
    expect(fs.existsSync(path.join(stored.dir, "review.json"))).toBe(true);
  });

  it("returns nothing when there's no review", () => {
    const stored = storeSkill(ID, HASH, files);
    expect(readReview(stored.dir)).toBeUndefined();
  });

  it("returns nothing when the review file is broken", () => {
    const stored = storeSkill(ID, HASH, files);
    fs.writeFileSync(path.join(stored.dir, "review.json"), "{nope");
    expect(readReview(stored.dir)).toBeUndefined();
  });
});
