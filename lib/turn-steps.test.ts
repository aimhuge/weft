import { describe, expect, it } from "vitest";
import { foldTurnSteps, stepsLabel, turnSteps, type Entry, type ToolsEntry } from "./turn-steps";
import type { ThreadItem } from "./types";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;
type Permission = Extract<ThreadItem, { kind: "permission" }>;

const tool = (over: Partial<ToolCall> = {}): ToolCall => ({ kind: "tool", id: "t", name: "Bash", summary: "ls", at: 1, result: "ok", ...over });
const permission = (over: Partial<Permission> = {}): Permission => ({ kind: "permission", id: "p", toolName: "Bash", title: "Run ls", decision: "allow", at: 1, ...over });
const run = (key: number, ...calls: (ToolCall | Permission)[]): ToolsEntry => ({ kind: "tools", calls: calls.length ? calls : [tool()], key });
const item = (key: number, it: ThreadItem): Entry => ({ kind: "item", item: it, key });
const user = (key: number) => item(key, { kind: "user", id: `u${key}`, text: "go", at: 1 });
const prose = (key: number) => item(key, { kind: "assistant", text: "Done.", at: 1 });

describe("foldTurnSteps", () => {
  it("merges every run in a turn into one steps row at the first run, keeping prose in place", () => {
    const rows = foldTurnSteps([user(0), run(1), prose(3), run(4), prose(6)]);
    expect(rows.map((r) => [r.kind, r.key])).toEqual([
      ["item", 0],
      ["steps", 1],
      ["item", 3],
      ["item", 6],
    ]);
    expect(rows[1]).toMatchObject({ runs: [{ key: 1 }, { key: 4 }] });
  });

  it("starts a new line after your message, a shell command, an edit or the turn's end", () => {
    const shell = item(2, { kind: "shell", command: "ls", output: "", at: 1 });
    const edited = item(4, { kind: "edited", items: [], at: 1 } as unknown as ThreadItem);
    const result = item(6, { kind: "result", text: "Turn finished", at: 1 } as ThreadItem);
    const rows = foldTurnSteps([run(1), shell, run(3), edited, run(5), result, run(7), user(8), run(9)]);
    expect(rows.filter((r) => r.kind === "steps").map((r) => r.key)).toEqual([1, 3, 5, 7, 9]);
  });

  it("leaves a run waiting on your answer, or one with nothing but permission rows, as it is", () => {
    const waiting = run(2, tool(), permission({ decision: undefined }));
    const onlyPermissions = run(3, permission());
    const rows = foldTurnSteps([user(0), run(1), waiting, onlyPermissions, run(4)]);
    expect(rows.map((r) => r.kind)).toEqual(["item", "steps", "tools", "tools"]);
    expect(rows[1]).toMatchObject({ runs: [{ key: 1 }, { key: 4 }] });
  });

  it("returns nothing for nothing", () => {
    expect(foldTurnSteps([])).toEqual([]);
  });
});

describe("stepsLabel", () => {
  it("counts steps", () => {
    expect(stepsLabel(1)).toBe("Weft ran 1 step");
    expect(stepsLabel(14)).toBe("Weft ran 14 steps");
  });
});

describe("turnSteps", () => {
  const runs = [
    run(1, tool({ id: "a", isError: true, images: ["/a.png"] }), permission({ decision: "deny" })),
    run(4, tool({ id: "b", name: "Read", action: "read", summary: "x.ts", images: ["/a.png", "/b.png"] }), tool({ id: "c", result: undefined })),
  ];

  it("counts tool calls, failures and denials, and keeps every screenshot once", () => {
    const steps = turnSteps(runs, false);
    expect(steps).toMatchObject({ label: "Weft ran 3 steps", failed: 1, denied: 1, running: undefined, images: ["/a.png", "/b.png"] });
    expect(steps.summary).toBe("Ran 2 commands, read a file");
  });

  it("names the call still running while the turn is live", () => {
    expect(turnSteps(runs, true).running?.id).toBe("c");
    expect(turnSteps([run(1, tool({ resultBytes: 10, result: undefined }))], true).running).toBeUndefined();
  });
});
