import { beforeEach, describe, expect, it, vi } from "vitest";

const haiku = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("./haiku", () => haiku);

const { REVIEW_MODEL, clearReviewCache, failed, parseReview, reviewPrompt, reviewSql } = await import("./sql-review");
const { scanSql } = await import("./sql-scan");

const GOOD = JSON.stringify({ verdict: "safe", summary: " adds an index ", statements: [], concerns: [] });

beforeEach(() => {
  clearReviewCache();
  haiku.complete.mockReset();
});

describe("reviewPrompt", () => {
  it("lists the flagged statements, the scan's concerns and the migration name", () => {
    const sql = "delete from t";
    const prompt = reviewPrompt(sql, scanSql(sql), "wipe_t");
    expect(prompt).toContain("- [loss] delete from t");
    expect(prompt).toContain("It also noted:\n- DELETE on t has no WHERE");
    expect(prompt).toContain("Migration name: wipe_t");
    expect(prompt).toContain("<sql>\ndelete from t\n</sql>");
    expect(prompt).not.toContain("characters; only the first");
  });

  it("says none were flagged, with no notes or name", () => {
    const prompt = reviewPrompt("select 1", scanSql("select 1"));
    expect(prompt).toContain("- (none)");
    expect(prompt).not.toContain("It also noted");
    expect(prompt).not.toContain("Migration name");
  });

  it("cuts SQL past 80000 characters and says so", () => {
    const sql = `select 1;${"x".repeat(80_000)}`;
    const prompt = reviewPrompt(sql, scanSql("select 1"));
    expect(prompt).toContain(`The SQL is ${sql.length} characters; only the first 80000 follow.`);
    expect(prompt).toContain(`<sql>\n${sql.slice(0, 80_000)}\n</sql>`);
  });
});

describe("parseReview", () => {
  it("reads the JSON out of prose around it", () => {
    const text = `Here you go: {"verdict":"deletes","summary":"wipes t","statements":[{"sql":"delete from t","does":"removes every row"},{"sql":"x","does":"  "},null],"loss":" all rows ","concerns":["no WHERE", " ", 3]} hope that helps`;
    expect(parseReview(text, "sonnet")).toEqual({
      verdict: "deletes",
      summary: "wipes t",
      statements: [{ sql: "delete from t", does: "removes every row" }],
      concerns: ["no WHERE"],
      loss: "all rows",
      model: "sonnet",
    });
  });

  it("defaults missing arrays to empty and omits an empty loss", () => {
    const review = parseReview('{"verdict":"access","statements":"nope"}', "m");
    expect(review).toEqual({ verdict: "access", summary: "", statements: [], concerns: [], model: "m" });
    expect("loss" in review).toBe(false);
  });

  it("is Can't tell for bad JSON", () => {
    expect(parseReview("{not json}", "m")).toEqual(failed("m", "The reviewer's answer didn't read as a review."));
  });

  it("is Can't tell for no JSON at all", () => {
    expect(parseReview("no idea", "m").error).toBe("The reviewer's answer didn't read as a review.");
  });

  it("is Can't tell for a verdict it doesn't know", () => {
    expect(parseReview('{"verdict":"fine"}', "m")).toEqual(failed("m", "The reviewer's answer didn't read as a review."));
  });
});

describe("reviewSql", () => {
  it("runs the review model once per SQL and name", async () => {
    const run = vi.fn().mockResolvedValue(GOOD);
    const first = await reviewSql("create index i on t (a)", "idx", run);
    const second = await reviewSql("create index i on t (a)", "idx", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.stringContaining("Migration name: idx"), REVIEW_MODEL);
    expect(second).toBe(first);
    expect(first).toEqual({ verdict: "safe", summary: "adds an index", statements: [], concerns: [], model: REVIEW_MODEL });
  });

  it("uses complete by default", async () => {
    haiku.complete.mockResolvedValue(GOOD);
    await expect(reviewSql("select 1")).resolves.toMatchObject({ verdict: "safe" });
    expect(haiku.complete).toHaveBeenCalledWith(expect.any(String), "sonnet");
  });

  it("turns a failed run into Can't tell and tries again next time", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("timed out")).mockResolvedValueOnce(GOOD);
    await expect(reviewSql("select 1", undefined, run)).resolves.toEqual(failed(REVIEW_MODEL, "timed out"));
    await Promise.resolve();
    await expect(reviewSql("select 1", undefined, run)).resolves.toMatchObject({ verdict: "safe" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("says the reviewer didn't answer for a non-Error rejection", async () => {
    const run = vi.fn().mockRejectedValue("boom");
    await expect(reviewSql("select 1", undefined, run)).resolves.toMatchObject({ verdict: "unknown", error: "The reviewer didn't answer." });
  });

  it("leaves a newer entry alone when an old failed review settles after the cache was cleared", async () => {
    let reject!: (e: Error) => void;
    const slow = vi.fn(() => new Promise<string>((_, r) => (reject = r)));
    const pending = reviewSql("select 1", undefined, slow);
    clearReviewCache();
    const fresh = vi.fn().mockResolvedValue(GOOD);
    const next = reviewSql("select 1", undefined, fresh);
    reject(new Error("late"));
    await pending;
    await Promise.resolve();
    expect(reviewSql("select 1", undefined, fresh)).toBe(next);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("forgets the oldest review past 20", async () => {
    const run = vi.fn().mockResolvedValue(GOOD);
    for (let i = 0; i <= 20; i++) await reviewSql(`select ${i}`, undefined, run);
    expect(run).toHaveBeenCalledTimes(21);
    await reviewSql("select 20", undefined, run);
    expect(run).toHaveBeenCalledTimes(21);
    await reviewSql("select 0", undefined, run);
    expect(run).toHaveBeenCalledTimes(22);
  });

  it("starts over after clearReviewCache", async () => {
    const run = vi.fn().mockResolvedValue(GOOD);
    await reviewSql("select 1", undefined, run);
    clearReviewCache();
    await reviewSql("select 1", undefined, run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
