import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

const sdk = vi.hoisted(() => ({ messages: [] as unknown[], calls: [] as unknown[] }));
const obs = vi.hoisted(() => ({ captured: [] as unknown[] }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => {
    sdk.calls.push(args);
    return (async function* () {
      await Promise.resolve();
      yield* sdk.messages;
    })();
  },
}));

vi.mock("./ai-observability", () => ({
  captureAiGeneration: (data: unknown) => {
    obs.captured.push(data);
    return Promise.resolve();
  },
}));

const { folderGuard, parseReview, reviewPrompt, runReviewAgent, REVIEW_MODEL } = await import("./skill-review-agent");

const SCAN = {
  verdict: "warn" as const,
  findings: [
    { severity: "warn" as const, category: "code" as const, rule: "pipe-to-shell", message: "Pipes a download into a shell", file: "scripts/run.sh", line: 3, excerpt: "curl x | sh" },
  ],
  license: { spdx: "MIT", kind: "permissive" as const },
  hosts: ["example.com"],
  files: 2,
  bytes: 40,
};

const success = (result: string) => ({ type: "result", subtype: "success", result, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } });

// The hook is called by the SDK with (input, toolUseId, options).
const call = (hook: ReturnType<typeof folderGuard>, input: unknown) => hook(input as HookInput, undefined, { signal: new AbortController().signal });

beforeEach(() => {
  sdk.messages = [];
  sdk.calls = [];
  obs.captured = [];
});

describe("folderGuard", () => {
  const root = "/tmp/weft-skill-folder";

  it("denies a read outside the skill's folder", async () => {
    const guard = folderGuard(root);
    const out = await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/etc/passwd" } });
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Only the skill's own folder can be read here, not /etc/passwd.`,
      },
    });
  });

  it("denies a read that climbs out with ..", async () => {
    const guard = folderGuard(root);
    const out = await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "../elsewhere/secret.txt" } });
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("denies a read outside the folder given as 'path'", async () => {
    const guard = folderGuard(root);
    const out = await call(guard, { hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { path: "/etc" } });
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("denies when either of the two paths is outside, even when the other is inside", async () => {
    const guard = folderGuard(root);
    const out = await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/weft-skill-folder/SKILL.md", path: "/etc/passwd" } });
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("allows a read inside the skill's folder", async () => {
    const guard = folderGuard(root);
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/weft-skill-folder/SKILL.md" } })).toEqual({});
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/weft-skill-folder/scripts/run.py" } })).toEqual({});
  });

  it("allows a relative read that stays inside the folder", async () => {
    const guard = folderGuard(root);
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "SKILL.md" } })).toEqual({});
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "scripts/run.py" } })).toEqual({});
  });

  it("allows a relative read that climbs back into the folder", async () => {
    const guard = folderGuard(root);
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "scripts/../SKILL.md" } })).toEqual({});
  });

  it("ignores events that aren't PreToolUse", async () => {
    const guard = folderGuard(root);
    expect(await call(guard, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/etc/passwd" } })).toEqual({});
  });

  it("allows a read with no path at all", async () => {
    const guard = folderGuard(root);
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read" })).toEqual({});
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} })).toEqual({});
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "" } })).toEqual({});
    expect(await call(guard, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: 42 } })).toEqual({});
  });
});

describe("reviewPrompt", () => {
  it("names the skill and pastes the static scan's findings as JSON", () => {
    const prompt = reviewPrompt("owner/repo/skill", SCAN);
    expect(prompt).toContain("Skill: owner/repo/skill.");
    expect(prompt).toContain("pipe-to-shell");
    expect(prompt).toContain("example.com");
    expect(prompt).toContain('"verdict": "warn"');
    expect(prompt).toContain('"license"');
    // The findings are JSON, so the reviewer can read them as data.
    const start = prompt.indexOf("\n{") + 1;
    const json = prompt.slice(start, prompt.indexOf("\n}", start) + 2);
    expect(JSON.parse(json)).toMatchObject({ verdict: "warn", hosts: ["example.com"] });
  });

  it("tells the reviewer the folder is untrusted and to answer with JSON only", () => {
    const prompt = reviewPrompt("label", SCAN);
    expect(prompt).toContain("untrusted");
    expect(prompt).toContain("only one JSON object");
  });
});

describe("parseReview", () => {
  const at = "2026-10-26T00:00:00.000Z";

  it("reads a plain JSON answer", () => {
    const review = parseReview(
      JSON.stringify({
        verdict: "safe",
        summary: "A summary.",
        whatItDoes: "Deploys.",
        concerns: [{ severity: "high", file: "scripts/run.sh", line: 3, explanation: "why" }],
        falsePositives: [{ rule: "pipe-to-shell", file: "README.md", line: 8, why: "an example" }],
        dataFlow: "Nothing leaves the machine.",
        license: "MIT.",
        recommendation: "install",
      }),
      at,
    );
    expect(review).toEqual({
      verdict: "safe",
      summary: "A summary.",
      whatItDoes: "Deploys.",
      concerns: [{ severity: "high", file: "scripts/run.sh", line: 3, explanation: "why" }],
      falsePositives: [{ rule: "pipe-to-shell", file: "README.md", line: 8, why: "an example" }],
      dataFlow: "Nothing leaves the machine.",
      license: "MIT.",
      recommendation: "install",
      model: REVIEW_MODEL,
      reviewedAt: at,
    });
  });

  it("reads the JSON out of prose around it", () => {
    const review = parseReview(`Here is my review:\n{"verdict":"unsafe","summary":"bad"}\nThat's all.`, at);
    expect(review?.verdict).toBe("unsafe");
    expect(review?.summary).toBe("bad");
  });

  it("returns nothing when the answer has no JSON", () => {
    expect(parseReview("no json here", at)).toBeUndefined();
  });

  it("returns nothing when the JSON is broken", () => {
    expect(parseReview("{verdict: safe}", at)).toBeUndefined();
    expect(parseReview('{"verdict": "safe",}', at)).toBeUndefined();
  });

  it("returns nothing when the braces don't make a whole object", () => {
    expect(parseReview("}", at)).toBeUndefined();
    expect(parseReview("}{", at)).toBeUndefined();
  });

  it("falls back to caution for a verdict it doesn't know", () => {
    expect(parseReview('{"verdict":"maybe"}', at)?.verdict).toBe("caution");
    expect(parseReview("{}", at)?.verdict).toBe("caution");
    expect(parseReview('{"verdict":42}', at)?.verdict).toBe("caution");
  });

  it("keeps safe and unsafe as they are", () => {
    expect(parseReview('{"verdict":"safe"}', at)?.verdict).toBe("safe");
    expect(parseReview('{"verdict":"unsafe"}', at)?.verdict).toBe("unsafe");
  });

  it("defaults a concern's severity to medium", () => {
    const review = parseReview('{"concerns":[{"severity":"high"},{"severity":"low"},{"severity":"nonsense"},{"severity":7}]}', at);
    expect(review?.concerns.map((c) => c.severity)).toEqual(["high", "low", "medium", "medium"]);
  });

  it("leaves out a concern's file when there is none, and rounds its line", () => {
    const review = parseReview('{"concerns":[{"severity":"high","line":3.7},{"severity":"high","file":"a.py","line":"x"}]}', at);
    expect(review?.concerns[0]).toEqual({ severity: "high", file: undefined, line: 4, explanation: "" });
    expect(review?.concerns[1]).toEqual({ severity: "high", file: "a.py", line: undefined, explanation: "" });
  });

  it("leaves out a false positive's file when there is none", () => {
    const review = parseReview('{"falsePositives":[{"rule":"r","why":"w"}]}', at);
    expect(review?.falsePositives[0]).toEqual({ rule: "r", file: undefined, line: undefined, why: "w" });
  });

  it("reads a list that isn't a list as no entries", () => {
    expect(parseReview('{"concerns":"nope"}', at)?.concerns).toEqual([]);
    expect(parseReview('{"falsePositives":{"a":1}}', at)?.falsePositives).toEqual([]);
  });

  it("drops entries in a list that aren't objects", () => {
    const review = parseReview('{"concerns":["nope",null,3,{"severity":"low"}]}', at);
    expect(review?.concerns).toEqual([{ severity: "low", file: undefined, line: undefined, explanation: "" }]);
  });

  it("takes at most thirty entries from a list", () => {
    const many = Array.from({ length: 50 }, () => ({ severity: "low" }));
    const review = parseReview(JSON.stringify({ concerns: many }), at);
    expect(review?.concerns).toHaveLength(30);
  });

  it("truncates a long string to 2000 characters", () => {
    const long = "x".repeat(2500);
    const review = parseReview(JSON.stringify({ summary: long, whatItDoes: long, dataFlow: long, license: long, recommendation: long }), at);
    expect(review?.summary).toHaveLength(2000);
    expect(review?.whatItDoes).toHaveLength(2000);
    expect(review?.dataFlow).toHaveLength(2000);
    expect(review?.license).toHaveLength(2000);
    expect(review?.recommendation).toHaveLength(2000);
  });

  it("reads a field that isn't a string as empty", () => {
    const review = parseReview('{"summary":42,"whatItDoes":null,"dataFlow":[]}', at);
    expect(review?.summary).toBe("");
    expect(review?.whatItDoes).toBe("");
    expect(review?.dataFlow).toBe("");
  });

  it("stamps the time it was reviewed, and the model", () => {
    const review = parseReview("{}", "2026-10-26T12:00:00.000Z");
    expect(review?.reviewedAt).toBe("2026-10-26T12:00:00.000Z");
    expect(review?.model).toBe(REVIEW_MODEL);
    expect(review?.model).toBe("sonnet");
  });
});

describe("runReviewAgent", () => {
  const filesDir = "/tmp/weft-skill-review";

  it("runs Sonnet in the skill's folder and returns the review it read", async () => {
    sdk.messages = [success('{"verdict":"safe","summary":"Fine.","dataFlow":"Nothing leaves the machine."}')];
    const review = await runReviewAgent(filesDir, "owner/repo/skill", SCAN);
    expect(review).toMatchObject({ verdict: "safe", summary: "Fine.", model: "sonnet" });
    expect(sdk.calls).toHaveLength(1);
    const args = sdk.calls[0] as { prompt: string; options: Record<string, unknown> };
    expect(args.prompt).toContain("Skill: owner/repo/skill.");
    expect(args.options.model).toBe("sonnet");
    expect(args.options.cwd).toBe(filesDir);
    expect(args.options.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(args.options.allowedTools).toEqual(["Read", "Grep", "Glob"]);
    expect(args.options.settingSources).toEqual([]);
    expect(args.options.persistSession).toBe(false);
  });

  it("holds the reviewer to the skill's folder with a hook", async () => {
    sdk.messages = [success('{"verdict":"safe"}')];
    await runReviewAgent(filesDir, "label", SCAN);
    const args = sdk.calls[0] as { options: { hooks: { PreToolUse: { matcher: string; hooks: unknown[] }[] } } };
    const matcher = args.options.hooks.PreToolUse[0]!;
    expect(matcher.matcher).toBe("Read|Grep|Glob");
    expect(matcher.hooks).toHaveLength(2);
  });

  it("records the run in the observability log", async () => {
    sdk.messages = [success('{"verdict":"safe"}')];
    await runReviewAgent(filesDir, "label", SCAN);
    expect(obs.captured).toHaveLength(1);
    expect(obs.captured[0]).toMatchObject({ spanName: "skill_review", model: "sonnet", isError: false, stream: true });
  });

  it("ignores the messages that aren't the result", async () => {
    sdk.messages = [{ type: "assistant" }, success('{"verdict":"safe"}')];
    const review = await runReviewAgent(filesDir, "label", SCAN);
    expect(review.verdict).toBe("safe");
  });

  it("throws when the run stops with an error", async () => {
    sdk.messages = [{ type: "result", subtype: "error_max_turns" }];
    await expect(runReviewAgent(filesDir, "label", SCAN)).rejects.toThrow("The review stopped: error_max_turns");
    expect(obs.captured[0]).toMatchObject({ isError: true, error: "error_max_turns" });
  });

  it("throws when the reviewer answers without any JSON", async () => {
    sdk.messages = [success("I could not review this skill.")];
    await expect(runReviewAgent(filesDir, "label", SCAN)).rejects.toThrow("The reviewer didn't return a review.");
  });
});
