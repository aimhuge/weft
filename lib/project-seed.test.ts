import { describe, expect, it } from "vitest";
import type { GhIssue } from "./github-issues";
import type { ProjectReport } from "./project-badges";
import { agentsSeed, checkSeeds, issueSeeds, MAX_SEEDS, pickSeeds, seedLine, todoSeed, type Seed } from "./project-seed";

const issue = (number: number, title = `Issue ${number}`): GhIssue => ({ number, title, url: `https://x/${number}`, state: "OPEN", updatedAt: "t" });
const report = (ok: Record<string, boolean>): ProjectReport => ({ root: "/r", name: "r", stack: [], ok, score: null, coverage: null, perfect: false, clean: true });
const seed = (kind: Seed["kind"], title: string): Seed => ({ kind, title, prompt: "p" });

describe("agentsSeed", () => {
  it("asks for /init and /weft:setup-done", () => {
    const s = agentsSeed("shop");
    expect(s.title).toBe("Set up shop for agents");
    expect(s.prompt).toContain("/init");
    expect(s.prompt).toContain("/weft:setup-done");
  });
});

describe("checkSeeds", () => {
  it("takes the two most important failing checks, never agent docs", () => {
    const s = checkSeeds(report({ agentDocs: false, readme: false, lockfile: false, envIgnored: false, upstream: true }));
    expect(s.map((x) => x.title)).toEqual(["Secrets ignored for r", "Lockfile for r"]);
    expect(s[0]?.prompt).toContain("production-ready tree for r");
  });

  it("gives nothing when the checks pass or weren't measured", () => {
    expect(checkSeeds(report({ envIgnored: true }))).toEqual([]);
  });
});

describe("issueSeeds", () => {
  it("dedupes, puts newest first and keeps three", () => {
    const s = issueSeeds("o/r", [issue(1), issue(5), issue(3), issue(5), issue(9, "  ")]);
    expect(s.map((x) => x.issue?.issue.number)).toEqual([9, 5, 3]);
    expect(s[0]?.title).toBe("o/r#9");
    expect(s[1]?.title).toBe("Issue 5");
  });
});

describe("todoSeed", () => {
  it("picks the densest file with enough TODOs", () => {
    const grep = ["a.ts:1:// TODO", "b/c.ts:2:// FIXME", "b/c.ts:5:// TODO", "b/c.ts:9:// TODO", "b/c.ts:12:// TODO", "noise"].join("\n");
    const s = todoSeed(grep);
    expect(s?.title).toBe("Clear the TODOs in c.ts");
    expect(s?.prompt).toContain("b/c.ts has 4 TODO/FIXME comments (lines 2, 5, 9, 12)");
  });

  it("elides line lists past twelve", () => {
    const grep = Array.from({ length: 14 }, (_, i) => `x.ts:${i + 1}:TODO`).join("\n");
    expect(todoSeed(grep)?.prompt).toContain("12, …)");
  });

  it("gives nothing for a sparse or empty repo", () => {
    expect(todoSeed("a.ts:1:TODO\na.ts:2:TODO")).toBeNull();
    expect(todoSeed("")).toBeNull();
  });
});

describe("pickSeeds", () => {
  it("orders by kind, skips what's on the board and caps", () => {
    const seeds = [seed("todo", "T"), seed("check", "C"), ...issueSeeds("o/r", [issue(2), issue(1)]), seed("agents", "A"), seed("migrations", "M")];
    const cards = [{ title: "  c " }, { title: "x", issue: { repo: "O/R", number: 1, url: "", state: "open" as const, updatedAt: "" } }];
    expect(pickSeeds(seeds, cards).map((s) => s.title)).toEqual(["A", "M", "Issue 2", "T"]);
    expect(pickSeeds(seeds, [], 2).map((s) => s.title)).toEqual(["A", "M"]);
    expect(MAX_SEEDS).toBe(6);
  });
});

describe("seedLine", () => {
  it("names the issue or the kind", () => {
    expect(seedLine("r", issueSeeds("o/r", [issue(4)])[0]!)).toBe('- r: starter card "Issue 4" (issue o/r#4)');
    expect(seedLine("r", seed("todo", "T"))).toBe('- r: starter card "T" (todo)');
  });
});
