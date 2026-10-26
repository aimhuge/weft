import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SkillReview, SkillScan } from "./types";

// A skill's AI review: where it stands, how it's started and what it's keyed by (lib/skill-review.ts).
// WEFT_DATA points at a temp dir before the imports, so the pages and the kept reviews land there.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-review-"));
process.env.WEFT_DATA = path.join(root, "data");

vi.mock("./skill-review-agent", () => ({ runReviewAgent: vi.fn() }));

const { runReviewAgent } = await import("./skill-review-agent");
const { CACHE_DIR, storeSkill } = await import("./skill-cache");
const { localTarget, pageFor, remoteTarget, reviewState, settled, startReview, REVIEW_PAGES } = await import("./skill-review");
import type { ReviewTarget } from "./skill-review";

const scan = (over: Partial<SkillScan> = {}): SkillScan => ({
  verdict: "clean",
  findings: [],
  license: { spdx: "MIT", kind: "permissive" },
  hosts: [],
  files: 1,
  bytes: 10,
  ...over,
});

const answer = (over: Partial<SkillReview> = {}): SkillReview => ({
  verdict: "safe",
  summary: "Fine.",
  whatItDoes: "Formats JSON.",
  concerns: [],
  falsePositives: [],
  dataFlow: "Nothing leaves the machine.",
  license: "MIT.",
  recommendation: "Install it.",
  model: "sonnet",
  reviewedAt: "2026-10-26T12:00:00.000Z",
  ...over,
});

const target = (over: Partial<ReviewTarget> = {}): ReviewTarget => ({
  key: "remote:owner/repo/demo@abc123",
  name: "demo",
  source: "skills.sh · owner/repo",
  filesDir: path.join(root, "files"),
  storeDir: path.join(root, "store", "demo"),
  scan: scan(),
  ...over,
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeAll(() => {
  fs.mkdirSync(path.join(root, "files"), { recursive: true });
  fs.writeFileSync(path.join(root, "files", "SKILL.md"), "# demo\n");
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(path.join(root, "store"), { recursive: true, force: true });
  fs.rmSync(REVIEW_PAGES, { recursive: true, force: true });
});

describe("reviewState", () => {
  it("is none when nothing has been started and no review is kept", () => {
    expect(reviewState(target())).toEqual({ status: "none" });
  });

  it("is done when a review is kept, with the review and the page", () => {
    const t = target();
    fs.mkdirSync(t.storeDir, { recursive: true });
    fs.writeFileSync(path.join(t.storeDir, "review.json"), JSON.stringify(answer()));
    const state = reviewState(t);
    expect(state.status).toBe("done");
    expect(state.status === "done" && state.review.verdict).toBe("safe");
    expect(state.status === "done" && state.page).toBe(pageFor(t));
  });

  it("is running while a review is in flight", async () => {
    let release: (() => void) | undefined;
    vi.mocked(runReviewAgent).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(answer()))));
    const t = target({ key: "running-key" });
    startReview(t);
    expect(reviewState(t)).toEqual({ status: "running", page: pageFor(t) });
    release?.();
    await settled(t.key);
  });

  it("is failed with the message when the agent threw", async () => {
    vi.mocked(runReviewAgent).mockRejectedValueOnce(new Error("the reviewer died"));
    const t = target({ key: "failed-key" });
    startReview(t);
    await settled(t.key);
    const state = reviewState(t);
    expect(state.status).toBe("failed");
    expect(state.status === "failed" && state.error).toBe("the reviewer died");
  });
});

describe("startReview", () => {
  it("writes a running page first, then the done page with the review", async () => {
    vi.mocked(runReviewAgent).mockResolvedValueOnce(answer());
    const t = target({ key: "start-key" });
    const state = startReview(t);
    expect(state).toEqual({ status: "running", page: pageFor(t) });

    // While it runs, the page says so.
    const running = fs.readFileSync(pageFor(t), "utf8");
    expect(running).toContain("Sonnet is reading the skill");
    expect(running).toContain(`<meta http-equiv="refresh" content="3">`);

    await settled(t.key);
    const done = fs.readFileSync(pageFor(t), "utf8");
    expect(done).toContain("Looks safe");
    expect(done).not.toContain("Sonnet is reading the skill");
    // The review is kept beside the copy it read.
    expect(fs.existsSync(path.join(t.storeDir, "review.json"))).toBe(true);
    expect(reviewState(t).status).toBe("done");
  });

  it("reuses a kept review without calling the agent", () => {
    const t = target({ key: "kept-key" });
    fs.mkdirSync(t.storeDir, { recursive: true });
    fs.writeFileSync(path.join(t.storeDir, "review.json"), JSON.stringify(answer({ summary: "Already read." })));
    const state = startReview(t);
    expect(state.status).toBe("done");
    expect(runReviewAgent).not.toHaveBeenCalled();
    // The page is written anyway, so the pane has it.
    expect(fs.readFileSync(pageFor(t), "utf8")).toContain("Already read.");
  });

  it("records a failure and a later start retries it", async () => {
    vi.mocked(runReviewAgent).mockRejectedValueOnce(new Error("boom"));
    const t = target({ key: "retry-key" });
    startReview(t);
    await settled(t.key);
    expect(reviewState(t).status).toBe("failed");
    expect(fs.readFileSync(pageFor(t), "utf8")).toContain("The review didn't finish: boom");

    // A later start tries again, and succeeds.
    vi.mocked(runReviewAgent).mockResolvedValueOnce(answer());
    const again = startReview(t);
    expect(again.status).toBe("running");
    await settled(t.key);
    expect(reviewState(t).status).toBe("done");
    expect(runReviewAgent).toHaveBeenCalledTimes(2);
  });

  it("records a failure whose message isn't an Error's", async () => {
    vi.mocked(runReviewAgent).mockRejectedValueOnce("just a string");
    const t = target({ key: "string-key" });
    startReview(t);
    await settled(t.key);
    const state = reviewState(t);
    expect(state.status === "failed" && state.error).toBe("just a string");
  });

  it("doesn't start a second review while one is running", async () => {
    let release: (() => void) | undefined;
    vi.mocked(runReviewAgent).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(answer()))));
    const t = target({ key: "once-key" });
    startReview(t);
    const second = startReview(t);
    expect(second.status).toBe("running");
    expect(runReviewAgent).toHaveBeenCalledTimes(1);
    release?.();
    await settled(t.key);
  });

  it("passes the skill's folder, a label and the scan to the agent", async () => {
    vi.mocked(runReviewAgent).mockResolvedValueOnce(answer());
    const t = target({ key: "args-key", name: "demo", source: "skills.sh · owner/repo", scan: scan({ verdict: "warn" }) });
    startReview(t);
    await settled(t.key);
    expect(runReviewAgent).toHaveBeenCalledWith(t.filesDir, "demo (skills.sh · owner/repo)", t.scan);
  });
});

describe("remoteTarget", () => {
  const id = "owner/repo/demo";
  const hash = "a".repeat(16);

  it("is undefined when Weft has no copy of it", () => {
    expect(remoteTarget(id)).toBeUndefined();
    expect(remoteTarget(id, hash)).toBeUndefined();
  });

  it("is the copy kept at the hash it was given", () => {
    const files = [{ path: "SKILL.md", contents: "---\nname: demo\ndescription: d\n---\n" }];
    storeSkill(id, hash, files);
    const t = remoteTarget(id, hash);
    expect(t?.key).toBe(`remote:${id}@${hash}`);
    expect(t?.name).toBe("demo");
    expect(t?.source).toBe("skills.sh · owner/repo");
    expect(t?.storeDir).toBe(path.join(CACHE_DIR, "owner", "repo", "demo", hash));
    expect(t?.filesDir).toBe(path.join(CACHE_DIR, "owner", "repo", "demo", hash, "files"));
    expect(t?.scan.files).toBe(1);
  });

  it("is the newest copy kept when no hash is given", () => {
    const files = [{ path: "SKILL.md", contents: "---\nname: demo\ndescription: d\n---\n" }];
    storeSkill(id, hash, files);
    const newer = "b".repeat(16);
    // A later fetch is a later copy; latestStored() sorts by fetchedAt.
    fs.writeFileSync(path.join(CACHE_DIR, "owner", "repo", "demo", hash, "meta.json"), JSON.stringify({ id, name: "demo", description: "d", hash, fetchedAt: "2026-01-01T00:00:00.000Z" }));
    storeSkill(id, newer, files);
    fs.writeFileSync(path.join(CACHE_DIR, "owner", "repo", "demo", newer, "meta.json"), JSON.stringify({ id, name: "demo", description: "d", hash: newer, fetchedAt: "2026-10-26T00:00:00.000Z" }));
    expect(remoteTarget(id)?.key).toBe(`remote:${id}@${newer}`);
  });
});

describe("localTarget", () => {
  it("is undefined for a name that isn't in the library", () => {
    expect(localTarget(root, "not-a-skill")).toBeUndefined();
  });

  it("is undefined when there's no folder to read", () => {
    expect(localTarget(undefined, "")).toBeUndefined();
  });

  it("is the skill's folder, keyed by its signature", () => {
    const dir = path.join(root, "library-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# mine\n");
    // skillDirs() reads ~/.claude/skills and the folder's own .claude/skills; a plugin's folder is
    // the pluginDir argument, so use that path for a skill Weft doesn't own.
    const t = localTarget(root, "mine", dir);
    expect(t?.name).toBe("mine");
    expect(t?.filesDir).toBe(dir);
    expect(t?.source).toBe(dir);
    expect(t?.key).toMatch(/^local:.+@[0-9a-f]{16}$/);
    expect(t?.storeDir).toContain(path.join("local"));
    expect(t?.scan.files).toBe(1);
  });

  it("is the plugin's folder when a pluginDir is given", () => {
    const dir = path.join(root, "plugin-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# plugin\n");
    const t = localTarget(undefined, "plugin@market", dir);
    expect(t?.filesDir).toBe(dir);
    expect(t?.name).toBe("plugin@market");
    expect(t?.scan.files).toBe(1);
  });

  it("gives two copies of the same name the same key, and a changed one a new key", () => {
    const dir = path.join(root, "changing");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# one\n");
    const first = localTarget(undefined, "changing", dir);
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# two\n");
    const second = localTarget(undefined, "changing", dir);
    expect(first?.key).not.toBe(second?.key);
  });
});
