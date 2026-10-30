import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();

vi.mock("./store", () => ({
  DATA_DIR: os.tmpdir(),
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = { ...cards.get(id)!, ...patch };
    cards.set(id, card);
    return card;
  }),
}));

const store = await import("./store");
const { claimHooks, claimQuestion, claimsFor, claimSymbols, claimWhy, MAX_SYMBOLS, releaseClaims } = await import("./claim-guard");

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-claims-")));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const file = path.join(tmp, "a.ts");
fs.writeFileSync(file, 'import x from "./x";\n\nexport function one() {\n  return 1;\n}\n\nexport function two() {\n  return 2;\n}\n');

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: tmp, backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

const signal = new AbortController().signal;

function pre(cardId: string | undefined, tool_name: string, tool_input: Record<string, unknown>, toolUseId: string | undefined) {
  const hook = claimHooks(() => cardId).pre.hooks[0]!;
  return hook({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: tmp } as never, toolUseId, { signal });
}

function post(cardId: string | undefined, toolUseId: string | undefined, event = "PostToolUse") {
  const hook = claimHooks(() => cardId).post.hooks[0]!;
  return hook({ hook_event_name: event, tool_name: "Edit", tool_input: {}, cwd: tmp } as never, toolUseId, { signal });
}

beforeEach(() => {
  cards.clear();
  vi.clearAllMocks();
});

describe("claimsFor", () => {
  it("claims the symbols an Edit or MultiEdit touches, by absolute path", async () => {
    expect(await claimsFor("Edit", { file_path: "a.ts", old_string: "return 1;" }, tmp)).toEqual([`${file}#one`]);
    expect(await claimsFor("MultiEdit", { file_path: file, edits: [{ old_string: "return 1;" }, { old_string: "return 2;" }] }, tmp)).toEqual([`${file}#one`, `${file}#two`]);
    expect(await claimsFor("Edit", { file_path: file, old_string: "return", replace_all: true }, tmp)).toEqual([`${file}#one`, `${file}#two`]);
  });

  it("goes by the file's real path, the way git names it", async () => {
    const link = path.join(tmp, "link");
    fs.symlinkSync(tmp, link);
    expect(await claimsFor("Edit", { file_path: path.join(link, "a.ts"), old_string: "return 1;" }, tmp)).toEqual([`${file}#one`]);
    expect(await claimsFor("Write", { file_path: path.join(link, "new.ts") }, tmp)).toEqual([`${tmp}/new.ts#*`]);
  });

  it("claims nothing for an edit to imports alone, or a tool that edits no file", async () => {
    expect(await claimsFor("Edit", { file_path: file, old_string: 'import x from "./x";' }, tmp)).toEqual([]);
    expect(await claimsFor("Read", { file_path: file }, tmp)).toEqual([]);
  });

  it("claims the whole file for Write, NotebookEdit, other files, a missing file or old_string, and a no-edits MultiEdit", async () => {
    const whole = [`${file}#*`];
    expect(await claimsFor("Write", { file_path: file, content: "" }, tmp)).toEqual(whole);
    expect(await claimsFor("NotebookEdit", { notebook_path: path.join(tmp, "n.ipynb") }, tmp)).toEqual([`${tmp}/n.ipynb#*`]);
    expect(await claimsFor("Edit", { file_path: "a.css", old_string: "x" }, tmp)).toEqual([`${tmp}/a.css#*`]);
    expect(await claimsFor("Edit", { file_path: "gone.ts", old_string: "x" }, tmp)).toEqual([`${tmp}/gone.ts#*`]);
    expect(await claimsFor("Edit", { file_path: file, old_string: "nowhere" }, tmp)).toEqual(whole);
    expect(await claimsFor("Edit", { file_path: file }, tmp)).toEqual(whole);
    expect(await claimsFor("MultiEdit", { file_path: file }, tmp)).toEqual(whole);
    expect(await claimsFor("Write", { file_path: "/no-such-dir/a.ts" }, tmp)).toEqual(["/no-such-dir/a.ts#*"]);
  });

  it("claims the whole file when an edit spans more than MAX_SYMBOLS symbols", async () => {
    const big = path.join(tmp, "big.ts");
    fs.writeFileSync(big, Array.from({ length: MAX_SYMBOLS + 1 }, (_, i) => `const s${i} = ${i};`).join("\n"));
    expect(await claimsFor("Edit", { file_path: big, old_string: " = ", replace_all: true }, tmp)).toEqual([`${big}#*`]);
  });
});

describe("the PreToolUse hook", () => {
  it("asks when another busy card in the tree holds the symbol, and titles the prompt with it", async () => {
    cards.set("me", card("me"));
    cards.set("other", card("other", { title: "Fix login", claims: [`${file}#one`] }));
    const out = await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "ask1");
    const question = "Card ‘Fix login’ is editing one in a.ts. Wait, or go ahead?";
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: question } });
    expect(claimQuestion("ask1")).toBe(question);
    expect(claimWhy("ask1")).toMatchObject({ category: "same-code", detail: "‘Fix login’ (running) has uncommitted edits to one" });
    expect(claimWhy(undefined)).toBeUndefined();
    expect(claimQuestion(undefined)).toBeUndefined();
  });

  it("lets an edit to another symbol through", async () => {
    cards.set("me", card("me"));
    cards.set("other", card("other", { claims: [`${file}#two`] }));
    expect(await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "free")).toEqual({});
    expect(claimQuestion("free")).toBeUndefined();
    expect(claimWhy("free")).toBeUndefined();
  });

  it("keeps the symbols an edit touches for the permission prompt, not a whole-file claim", async () => {
    cards.set("me", card("me"));
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "sym1");
    expect(claimSymbols("sym1")).toEqual(["one"]);
    await pre("me", "Write", { file_path: file, content: "" }, "sym2");
    expect(claimSymbols("sym2")).toBeUndefined();
    await pre("me", "Edit", { file_path: file, old_string: 'import x from "./x";' }, "sym3");
    expect(claimSymbols("sym3")).toBeUndefined();
    expect(claimSymbols("never")).toBeUndefined();
    expect(claimSymbols(undefined)).toBeUndefined();
  });

  it("does nothing without a card, a tool use id, a claim, or outside PreToolUse", async () => {
    cards.set("me", card("me"));
    expect(await pre(undefined, "Edit", { file_path: file, old_string: "return 1;" }, "n1")).toEqual({});
    expect(await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, undefined)).toEqual({});
    expect(await pre("me", "Read", { file_path: file }, "n2")).toEqual({});
    expect(await pre("me", "Edit", undefined as never, "n3")).toEqual({});
    const hook = claimHooks(() => "me").pre.hooks[0]!;
    expect(await hook({ hook_event_name: "PostToolUse" } as never, "t", { signal })).toEqual({});
  });
});

describe("the PostToolUse hook", () => {
  it("puts an edit's claims on its card once it has run, once", async () => {
    cards.set("me", card("me"));
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "rec");
    await post("me", "rec");
    expect(cards.get("me")?.claims).toEqual([`${file}#one`]);
    await post("me", "rec");
    expect(store.updateCard).toHaveBeenCalledTimes(1);
  });

  it("skips the write when the card already holds the claims, and a card that's gone", async () => {
    cards.set("me", card("me", { claims: [`${file}#one`] }));
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "same");
    await post("me", "same");
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "gone");
    await post("nobody", "gone");
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "spare");
    await post(undefined, "spare");
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("ignores other events and tool calls it didn't see", async () => {
    cards.set("me", card("me"));
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "ev");
    expect(await post("me", "ev", "PreToolUse")).toEqual({});
    expect(await post("me", undefined)).toEqual({});
    expect(await post("me", "never")).toEqual({});
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("forgets the oldest pending edits past its cap", async () => {
    cards.set("me", card("me"));
    await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, "oldest");
    for (let i = 0; i < 200; i++) await pre("me", "Edit", { file_path: file, old_string: "return 1;" }, `p${i}`);
    await post("me", "oldest");
    expect(store.updateCard).not.toHaveBeenCalled();
  });
});

describe("claimsFor on Markdown", () => {
  it("claims blocks, not the file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-claims-"));
    const doc = path.join(dir, "MAP.md");
    fs.writeFileSync(doc, "## Map\n\n- one\n- two\n");
    const keys = await claimsFor("Edit", { file_path: doc, old_string: "- two", new_string: "- two!" }, dir);
    expect(keys.map((k) => k.slice(k.indexOf("#") + 1))).toEqual(["Map/two", "Map/two!"]);
    const missing = await claimsFor("Edit", { file_path: doc, old_string: "- nope", new_string: "x" }, dir);
    expect(missing.map((k) => k.slice(k.indexOf("#") + 1))).toEqual(["*"]);
    expect((await claimsFor("Write", { file_path: doc, content: "x" }, dir)).map((k) => k.slice(k.indexOf("#") + 1))).toEqual(["*"]);
  });
});

describe("releaseClaims", () => {
  it("drops every card's claims on the committed files", () => {
    cards.set("a", card("a", { claims: [`${file}#one`, "/b.ts#*"] }));
    cards.set("b", card("b", { claims: ["/b.ts#*"] }));
    releaseClaims([file]);
    expect(cards.get("a")?.claims).toEqual(["/b.ts#*"]);
    expect(store.updateCard).toHaveBeenCalledTimes(1);
  });

  it("drops only the committer's claims on a file the commit held lines back from", () => {
    cards.set("a", card("a", { claims: [`${file}#one`] }));
    cards.set("b", card("b", { claims: [`${file}#two`] }));
    releaseClaims([file], [file], "a");
    expect(cards.get("a")?.claims).toEqual([]);
    expect(cards.get("b")?.claims).toEqual([`${file}#two`]);
  });
});
