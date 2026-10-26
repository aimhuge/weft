import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// Symbol claims for Bash (lib/bash-claims.ts). A shell command writes files too (sed -i, a formatter,
// `cat > f`), so before one runs, the files its line names as written that another busy card claims ask
// first; after it runs, in a git repo, the files git says it changed become whole-file claims, claims on
// now-clean files drop, and a failed check is told whose failures it may be seeing. Board data, the
// command line and (mocked) git status — no git of its own here.

const cards = new Map<string, Card>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = { ...cards.get(id)!, ...patch };
    cards.set(id, card);
    return card;
  }),
}));

const dirty = { root: undefined as string | undefined, list: undefined as string[] | undefined };
const repoRoot = vi.fn(() => dirty.root);
const dirtyFiles = vi.fn(() => dirty.list);
// Each file was written the moment the run started, unless a test says otherwise.
const stamped = (files: string[], since: number) => new Map(files.map((f) => [f, since]));
const writtenAt = vi.fn(stamped);

vi.mock("./dirty-files", () => ({ repoRoot, dirtyFiles, writtenAt }));

const store = await import("./store");
const { claimQuestion, claimWhy } = await import("./claim-guard");
const { bashClaimHooks, outputOf } = await import("./bash-claims");
const writers = await import("./bash-writers");

// A fake repo tree, all of it real under one root so the guards compare like paths.
const root = "/weft-tree";
const other = "/elsewhere";
const held = `${root}/lib/held.ts`;
const free = `${root}/lib/free.ts`;

// This card's own cwd is `root`; each test adds the other busy cards it needs.
function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: root, backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

// The usual other card: busy in this tree, holding a whole-file claim on held.ts.
const holder = (over: Partial<Card> = {}) => card("other", { title: "Fix login", claims: [`${held}#*`], ...over });

const signal = new AbortController().signal;

function pre(cardId: () => string | undefined, command: string, toolUseId: string | undefined, cwd = root) {
  const hook = bashClaimHooks(cardId).pre.hooks[0]!;
  return hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd } as never, toolUseId, { signal });
}

function post(
  cardId: () => string | undefined,
  toolUseId: string | undefined,
  tool_input: Record<string, unknown> = { command: "pnpm build" },
  response?: unknown,
  event = "PostToolUse",
  cwd = root,
) {
  const hook = bashClaimHooks(cardId).post.hooks[0]!;
  return hook({ hook_event_name: event, tool_name: "Bash", tool_input, cwd, ...(event === "PostToolUseFailure" ? { error: response as string } : { tool_response: response }) } as never, toolUseId, { signal });
}

beforeEach(() => {
  cards.clear();
  vi.clearAllMocks();
  writtenAt.mockImplementation(stamped);
  writers.resetWriters();
  dirty.root = root;
  dirty.list = [];
  cards.set("me", card("me"));
});

describe("the PreToolUse hook", () => {
  it("asks when a command's line writes a file another busy card in the tree claims", async () => {
    cards.set("other", holder());
    const out = await pre(() => "me", `sed -i '' 's/a/b/' ${held}`, "ask1");
    const question = "Card ‘Fix login’ is editing held.ts. Wait, or go ahead?";
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: question } });
    expect(claimQuestion("ask1")).toBe(question);
    expect(claimWhy("ask1")).toMatchObject({ category: "whole-file", detail: "‘Fix login’ (running) has uncommitted edits to held.ts" });
  });

  it("asks on a redirect too, and on a whole-file claim of a symbol-only claim", async () => {
    cards.set("other", card("other", { title: "Login refactor", claims: [`${held}#one`] }));
    expect(await pre(() => "me", `echo x > ${held}`, "r1")).toMatchObject({ hookSpecificOutput: { permissionDecision: "ask" } });
    expect(claimQuestion("r1")).toBe("Card ‘Login refactor’ is editing one in held.ts. Wait, or go ahead?");
  });

  it("lets a command through when it writes nothing claimed, or when only a card in another tree holds the file", async () => {
    cards.set("other", holder());
    expect(await pre(() => "me", `sed -i '' 's/a/b/' ${free}`, "free")).toEqual({});
    expect(claimQuestion("free")).toBeUndefined();
    // A busy card elsewhere holds the same file, but a separate tree doesn't clash.
    cards.set("other", holder({ cwd: other }));
    expect(await pre(() => "me", `sed -i '' 's/a/b/' ${held}`, "away")).toEqual({});
    expect(await pre(() => "me", "ls -la", "noop")).toEqual({});
    expect(await pre(() => "me", `sed -i '' 's/a/b/' ${held}`, undefined)).toEqual({});
  });

  it("does nothing outside PreToolUse, or without a card", async () => {
    cards.set("other", holder());
    const hook = bashClaimHooks(() => "me").pre.hooks[0]!;
    expect(await hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "x" }, cwd: root } as never, "ev", { signal })).toEqual({});
    expect(await pre(() => undefined, `sed -i '' 's/a/b/' ${held}`, "noc")).toEqual({});
    expect(await pre(() => "nobody", `sed -i '' 's/a/b/' ${held}`, "unknown")).toEqual({});
  });

  it("treats a non-string command as writing nothing", async () => {
    const hook = bashClaimHooks(() => "me").pre.hooks[0]!;
    expect(await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: 42 }, cwd: root } as never, "num", { signal })).toEqual({});
    expect(await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: null, cwd: root } as never, "nil", { signal })).toEqual({});
  });
});

describe("the PostToolUse hook", () => {
  it("claims the files written during the run as whole-file keys, skipping another busy card's", async () => {
    cards.set("other", holder());
    await pre(() => "me", "pnpm build", "run1");
    dirty.list = [held, free];
    await post(() => "me", "run1");
    // `held` is another busy card's, so it isn't claimed; `free` is.
    expect(cards.get("me")?.claims).toEqual([`${free}#*`]);
    expect(writtenAt).toHaveBeenCalledWith(dirty.list, expect.any(Number));
    expect(repoRoot).toHaveBeenCalledWith(root);
    expect(dirtyFiles).toHaveBeenCalledWith(root);
  });

  it("claims nothing new without a prior pre hook, but still releases and notes", async () => {
    dirty.list = [free];
    await post(() => "me", "never");
    expect(cards.get("me")?.claims).toBeUndefined();
    expect(writtenAt).not.toHaveBeenCalled();
  });

  it("ignores other events and a call with no tool use id", async () => {
    dirty.list = [free];
    expect(await post(() => "me", undefined, { command: "pnpm build" }, undefined, "PreToolUse")).toEqual({});
    await pre(() => "me", "pnpm build", "ev2");
    expect(await post(() => "me", "ev2", { command: "pnpm build" }, undefined, "PreToolUse")).toEqual({});
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("does nothing outside a repo, when git can't say, or without a card", async () => {
    await pre(() => "me", "pnpm build", "r");
    dirty.root = undefined;
    expect(await post(() => "me", "r")).toEqual({});
    dirty.root = root;
    dirty.list = undefined;
    expect(await post(() => "me", "r")).toEqual({});
    expect(writtenAt).not.toHaveBeenCalled();
    // A post with no tool use id never has a start time, so it claims nothing even inside a repo.
    dirty.list = [free];
    expect(await post(() => undefined, undefined)).toEqual({});
    expect(await post(() => "nobody", undefined)).toEqual({});
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("drops every card's claims on files under the root that are clean now, keeping dirty ones and files outside the root", async () => {
    cards.set("me", card("me", { claims: [`${free}#*`, `${root}/lib/committed.ts#one`, `${other}/outside.ts#*`, "/other-tree/x.ts#*"] }));
    cards.set("other", card("other", { title: "Fix login", claims: [`${held}#*`, `${root}/lib/committed.ts#two`] }));
    dirty.list = [held];
    await pre(() => "me", "git commit -m x", "commit");
    // Nothing new was written since the run, so only the release runs.
    writtenAt.mockImplementation(() => new Map());
    await post(() => "me", "commit");
    // `free` and `committed.ts` are clean now; `held` is still dirty, and both outside-root files stay.
    expect(cards.get("me")?.claims).toEqual([`${other}/outside.ts#*`, "/other-tree/x.ts#*"]);
    expect(cards.get("other")?.claims).toEqual([`${held}#*`]);
    expect(store.updateCard).toHaveBeenCalledTimes(2);
  });

  it("keeps claims on files still dirty and skips a card with nothing to release", async () => {
    cards.set("me", card("me", { claims: [`${free}#*`] }));
    cards.set("other", card("other", { title: "Fix login" }));
    dirty.list = [free];
    await pre(() => "me", "ls", "keep");
    writtenAt.mockImplementation(() => new Map());
    await post(() => "me", "keep");
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("forgets a call it recorded, so a second post for it claims nothing", async () => {
    await pre(() => "me", "pnpm build", "once");
    dirty.list = [free];
    await post(() => "me", "once");
    const claims = cards.get("me")?.claims;
    await post(() => "me", "once");
    expect(cards.get("me")?.claims).toEqual(claims);
    expect(writtenAt).toHaveBeenCalledTimes(1);
    expect(store.updateCard).toHaveBeenCalledTimes(1);
  });
});

describe("the failure note", () => {
  it("names the card whose file the failing check reports, on PostToolUseFailure", async () => {
    cards.set("other", holder());
    const error = "lib/held.ts(12,3): error TS2304: Cannot find name 'x'.";
    await pre(() => "me", "pnpm typecheck", "fail1");
    dirty.list = [held];
    const out = await post(() => "me", "fail1", { command: "pnpm typecheck" }, error, "PostToolUseFailure");
    expect(out).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PostToolUseFailure",
        additionalContext: expect.stringContaining("- lib/held.ts: ‘Fix login’") as string,
      },
    });
    expect((out as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext).toContain("another card is editing right now");
  });

  it("names it from a tool response as a string, and from stdout and stderr", async () => {
    cards.set("other", holder());
    const line = "lib/held.ts(1,1): error TS1";
    dirty.list = [held]; // still uncommitted, so the claim stands
    await pre(() => "me", "pnpm typecheck", "str");
    expect(await post(() => "me", "str", { command: "pnpm typecheck" }, line)).toMatchObject({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: expect.stringContaining("‘Fix login’") as string },
    });
    await pre(() => "me", "pnpm typecheck", "obj");
    expect(await post(() => "me", "obj", { command: "pnpm typecheck" }, { stdout: line, stderr: "" })).toMatchObject({
      hookSpecificOutput: { additionalContext: expect.stringContaining("‘Fix login’") as string },
    });
    await pre(() => "me", "pnpm typecheck", "err");
    expect(await post(() => "me", "err", { command: "pnpm typecheck" }, { stdout: "", stderr: line })).toMatchObject({
      hookSpecificOutput: { additionalContext: expect.stringContaining("‘Fix login’") as string },
    });
  });

  it("says nothing extra when the check passes, or when the failure isn't in a claimed file", async () => {
    await pre(() => "me", "pnpm typecheck", "ok");
    expect(await post(() => "me", "ok", { command: "pnpm typecheck" }, "No errors found.")).toEqual({});
    await pre(() => "me", "pnpm typecheck", "elsewhere");
    expect(await post(() => "me", "elsewhere", { command: "pnpm typecheck" }, "lib/mine.ts(1,1): error TS1")).toEqual({});
    // No claims to point at on any other busy card.
    cards.set("other", card("other"));
    await pre(() => "me", "pnpm typecheck", "none");
    expect(await post(() => "me", "none", { command: "pnpm typecheck" }, "lib/held.ts(1,1): error TS1")).toEqual({});
  });

  it("treats a response that is neither a string nor a pair as empty output", async () => {
    await pre(() => "me", "pnpm typecheck", "blank");
    expect(await post(() => "me", "blank", { command: "pnpm typecheck" }, null)).toEqual({});
    await pre(() => "me", "pnpm typecheck", "nums");
    expect(await post(() => "me", "nums", { command: "pnpm typecheck" }, { stdout: 1, stderr: 2 })).toEqual({});
  });
});

describe("the result's text", () => {
  it("is the error on a failure, the response on a post, and nothing at all on any other event", () => {
    expect(outputOf({ hook_event_name: "PostToolUseFailure", error: "boom" } as never)).toBe("boom");
    expect(outputOf({ hook_event_name: "PostToolUse", tool_response: "all good" } as never)).toBe("all good");
    expect(outputOf({ hook_event_name: "PostToolUse", tool_response: { stdout: "out", stderr: "err" } } as never)).toBe("out\nerr");
    // Any other event carries no result at all.
    expect(outputOf({ hook_event_name: "PreToolUse" } as never)).toBe("");
  });
});

describe("an unknown writer under the root", () => {
  it("is forgotten once the file is clean", async () => {
    writers.markUnknown(`${root}/lib/unknown.ts`);
    dirty.list = [];
    await post(() => "me", "none");
    expect([...writers.unknownWriters()]).toEqual([]);
  });
});

describe("bashClaimHooks", () => {
  it("both match Bash", () => {
    const hooks = bashClaimHooks(() => "me");
    expect(hooks.pre.matcher).toBe("Bash");
    expect(hooks.post.matcher).toBe("Bash");
    expect(hooks.pre.hooks).toHaveLength(1);
    expect(hooks.post.hooks).toHaveLength(1);
  });
});