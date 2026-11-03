// card.list and thread.* on a Weft Worker (lib/worker-reads.ts through lib/host/dispatch.ts): answered from its own
// store as its rows carry them, over a `host` row or a session line alike, and never for a card it doesn't run.
import { describe, expect, it, vi } from "vitest";
import { card, command, fakeEngine, fakeGithub, fakePublisher, fakeReg, makeDeps } from "./worker-daemon.harness";
import type { DaemonDeps } from "./worker-daemon";
import { workerKinds } from "./worker-kinds";

const host = (verb: string, args: Record<string, unknown> = {}) => command({ kind: "host", payload: { verb, args } as never });
const KEY = "sk-ant-api03-" + "A".repeat(90);

describe("card.list on a worker", () => {
  it("answers the publisher's projection, as a host-level verb with no card", async () => {
    const d = makeDeps();
    await d.daemon.runOne(host("card.list", { id: "card-1" }));
    expect(d.snapshot).toHaveBeenCalledOnce();
    expect(d.host).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null, { ok: true, cardId: "", value: { cards: [{ card: card(), folder: "weft" }] } });
  });
});

describe("thread reads on a worker", () => {
  it("answers a page in the projection its rows carry: the env block gone and a key redacted", async () => {
    const d = makeDeps();
    d.host.mockResolvedValueOnce({ items: [{ kind: "user", text: `use ${KEY}<weft-env>\nsecret\n</weft-env>`, at: 1 }], start: 4, total: 5 });
    await d.daemon.runOne(host("thread.page", { id: "card-1", limit: 1 }));
    expect(d.host).toHaveBeenCalledWith("thread.page", { id: "card-1", limit: 1 });
    const result = d.report.mock.calls[0]?.[4] as { value: { items: { text: string }[]; start: number; total: number } };
    expect(result.value).toMatchObject({ start: 4, total: 5 });
    expect(result.value.items[0]?.text).not.toContain(KEY);
    expect(result.value.items[0]?.text).not.toContain("weft-env");
  });

  it("redacts a tool's whole result, and finds over the redacted thread so a guess at a key finds nothing", async () => {
    const d = makeDeps();
    d.host.mockResolvedValueOnce({ result: `token ${KEY}` });
    await d.daemon.runOne(host("thread.tool", { id: "card-1", toolId: "t1" }));
    expect((d.report.mock.calls[0]?.[4] as { value: { result: string } }).value.result).not.toContain(KEY);
    d.host.mockResolvedValue({ items: [{ kind: "assistant", text: `the key is ${KEY}`, at: 1 }], start: 0, total: 1 });
    await d.daemon.runOne(host("thread.search", { id: "card-1", q: "sk-ant-api03-AAAA" }));
    expect(d.host).toHaveBeenLastCalledWith("thread.page", { id: "card-1" });
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "done", "card-1", null, { ok: true, cardId: "card-1", value: { matches: [] } });
    await d.daemon.runOne(host("thread.search", { id: "card-1", q: "THE KEY" }));
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "done", "card-1", null, { ok: true, cardId: "card-1", value: { matches: [{ index: 0, hits: 1 }] } });
    await d.daemon.runOne(host("thread.search", { id: "card-1" }));
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "done", "card-1", null, { ok: true, cardId: "card-1", value: { matches: [] } });
  });

  it("refuses a card it doesn't run, and the copilot's", async () => {
    const eng = fakeEngine({ "card-1": card(), co: card({ id: "co", role: "copilot" }) });
    const d = makeDeps({ engine: eng.engine });
    await d.daemon.runOne(host("thread.page", { id: "card-9" }));
    await d.daemon.runOne(host("thread.tool", { id: "co", toolId: "t1" }));
    expect(eng.host).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, "That thread isn't on this worker.", expect.anything());
  });
});

describe("reads over a session line", () => {
  it("answer as a row does: card.list's snapshot and a thread page", async () => {
    let run: (payload: unknown) => Promise<unknown> = () => Promise.resolve();
    const line = vi.fn((_: unknown, r: typeof run) => {
      run = r;
      return Promise.resolve();
    });
    const eng = fakeEngine();
    const pub = fakePublisher();
    const deps = { reg: fakeReg().reg, engine: eng.engine, publisher: pub.publisher, checkout: vi.fn(), login: vi.fn(), clone: vi.fn(), github: fakeGithub(), line } as unknown as DaemonDeps;
    const kinds = workerKinds(deps, { log: vi.fn(), askForUpdate: () => null });
    await kinds.line!(command({ kind: "line", payload: { sealed: { v: 1, epk: "a", iv: "b", ct: "c", tag: "d" } } as never }));
    await expect(run({ verb: "card.list", args: {} })).resolves.toEqual({ cardId: "", result: { ok: true, cardId: "", value: { cards: [{ card: card(), folder: "weft" }] } } });
    eng.host.mockResolvedValueOnce({ items: [], start: 0, total: 0 });
    await expect(run({ verb: "thread.page", args: { id: "card-1" } })).resolves.toMatchObject({ result: { value: { items: [], total: 0 } } });
  });
});
