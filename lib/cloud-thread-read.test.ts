import { describe, expect, it, vi } from "vitest";

vi.mock("./worker-board-open", () => ({
  openItemRows: (_org: string, rows: unknown[]) => Promise.resolve(rows),
  openOutput: (_org: string, _card: string, _tool: string, result: string) => Promise.resolve(`opened ${result}`),
}));
vi.mock("./cloud-thread-page", () => ({ pageFromRows: (cardId: string, rows: unknown[]) => ({ cardId, rows }) }));

import { threadPageIn, toolOutputIn } from "./cloud-thread-read";

type Result = { data: unknown; error: { message: string } | null };

function client(...answers: Result[]) {
  const calls: [string, ...unknown[]][][] = [];
  const from = () => {
    const mine: [string, ...unknown[]][] = [];
    calls.push(mine);
    const answer = answers.shift() ?? { data: [], error: null };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lt", "gt", "order", "limit"]) b[m] = (...args: unknown[]) => (mine.push([m, ...args]), b);
    b.maybeSingle = () => Promise.resolve(answer);
    b.then = (ok: (r: Result) => unknown) => Promise.resolve(answer).then(ok);
    return b;
  };
  return { calls, c: { from } as never };
}

describe("threadPageIn", () => {
  it("reads a page in the given workspace, walking back with before", async () => {
    const { c, calls } = client({ data: [{ card_id: "c", seq: 1, item: {} }], error: null });
    expect(await threadPageIn(c, "org-x", "c", 5)).toEqual({ cardId: "c", rows: [{ card_id: "c", seq: 1, item: {} }] });
    expect(calls[0]).toContainEqual(["eq", "org_id", "org-x"]);
    expect(calls[0]).toContainEqual(["lt", "seq", 5]);
  });

  it("answers the items past after, or an empty page that still carries the total", async () => {
    const some = client({ data: [{ card_id: "c", seq: 9, item: {} }], error: null });
    expect(await threadPageIn(some.c, "o", "c", undefined, 8)).toMatchObject({ cardId: "c" });
    expect(some.calls[0]).toContainEqual(["gt", "seq", 8]);
    const none = client({ data: [], error: null }, { data: [{ seq: 4 }], error: null });
    expect(await threadPageIn(none.c, "o", "c", undefined, 8)).toEqual({ items: [], start: 9, total: 5 });
    const empty = client({ data: [], error: null }, { data: [], error: null });
    expect(await threadPageIn(empty.c, "o", "c", undefined, 0)).toEqual({ items: [], start: 1, total: 0 });
  });

  it("is null when either read fails", async () => {
    expect(await threadPageIn(client({ data: null, error: { message: "no" } }).c, "o", "c")).toBeNull();
    expect(await threadPageIn(client({ data: [], error: null }, { data: null, error: { message: "no" } }).c, "o", "c", undefined, 3)).toBeNull();
  });
});

describe("toolOutputIn", () => {
  it("opens the cut output, or says it isn't there", async () => {
    expect(await toolOutputIn(client({ data: { result: "r" }, error: null }).c, "o", "c", "t")).toBe("opened r");
    await expect(toolOutputIn(client({ data: null, error: null }).c, "o", "c", "t")).rejects.toThrow("That output isn't there.");
    await expect(toolOutputIn(client({ data: null, error: { message: "x" } }).c, "o", "c", "t")).rejects.toThrow("That output isn't there.");
  });
});
