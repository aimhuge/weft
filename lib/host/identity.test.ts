import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudCommandRow } from "../cloud-commands";
import { doneOutcome, failedOutcome, keyLine, sessionLine } from "./identity";

const row = (over: Partial<CloudCommandRow> = {}) => ({ id: "c1", kind: "reply", ...over }) as CloudCommandRow;

describe("outcomes", () => {
  it("reads a card, nothing, or a host verb's card and result", () => {
    expect(doneOutcome("card-1")).toEqual({ status: "done", cardId: "card-1" });
    expect(doneOutcome(null)).toEqual({ status: "done", cardId: null });
    // A result that names no card (a pin's receipt) reports none.
    expect(doneOutcome({ cardId: "", result: { ok: true, cardId: "" } })).toEqual({ status: "done", cardId: null, result: { ok: true, cardId: "" } });
    expect(doneOutcome({ cardId: "card-1", result: { ok: true, cardId: "card-1" } })).toEqual({ status: "done", cardId: "card-1", result: { ok: true, cardId: "card-1" } });
    // A verb on the host itself touched no card, so the row's card_id stays null.
    expect(doneOutcome({ cardId: "", result: { ok: true, cardId: "" } })).toEqual({ status: "done", cardId: null, result: { ok: true, cardId: "" } });
  });

  it("cuts a failure to 300 characters, and gives a host command a failed result", () => {
    expect(failedOutcome(row(), new Error("x".repeat(400))).error).toHaveLength(300);
    expect(failedOutcome(row(), new Error("no"))).toEqual({ status: "failed", error: "no" });
    expect(failedOutcome(row({ kind: "host" }), new Error("no"))).toEqual({ status: "failed", error: "no", result: { ok: false, error: "no" } });
  });
});

// A stand-in for the account's client: each call chain records its steps and answers with `answer`.
function fakeClient(answer: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "update", "eq", "in", "order", "limit", "overrideTypes"]) chain[step] = (...args: unknown[]) => (calls.push([step, ...args]), chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(answer).then(resolve);
  const rpc = (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), Promise.resolve(answer));
  return { client: { from: () => chain, rpc } as unknown as SupabaseClient, calls };
}

describe("sessionLine (a Mac)", () => {
  it("reads its device's pending rows, its own, oldest first", async () => {
    const { client, calls } = fakeClient({ data: [row()], error: null });
    expect(await sessionLine(client, "u1", "mac-1", vi.fn()).pending()).toEqual([row()]);
    expect(calls).toContainEqual(["eq", "target_device", "mac-1"]);
    expect(calls).toContainEqual(["eq", "created_by", "u1"]);
    expect(calls).toContainEqual(["limit", 20]);
  });

  it("throws a failed read", async () => {
    const { client } = fakeClient({ data: null, error: { message: "offline" } });
    await expect(sessionLine(client, "u1", "mac-1", vi.fn()).pending()).rejects.toThrow("offline");
  });

  it("claims only a pending row, and takes an error or no match as not claimed", async () => {
    const got = fakeClient({ data: [{ id: "c1" }], error: null });
    expect(await sessionLine(got.client, "u1", "mac-1", vi.fn()).claim("c1")).toBe(true);
    expect(got.calls).toContainEqual(["eq", "status", "pending"]);
    expect(await sessionLine(fakeClient({ data: [], error: null }).client, "u1", "m", vi.fn()).claim("c1")).toBe(false);
    expect(await sessionLine(fakeClient({ data: null, error: { message: "x" } }).client, "u1", "m", vi.fn()).claim("c1")).toBe(false);
  });

  it("reports through the update grant, and only warns when that fails", async () => {
    const ok = fakeClient({ error: null });
    const line = sessionLine(ok.client, "u1", "m", vi.fn());
    await line.report("c1", { status: "done", cardId: "k" });
    await line.report("c1", { status: "done", cardId: "k", result: { ok: true, cardId: "k" } });
    await line.report("c1", { status: "failed", error: "no" });
    await line.report("c1", { status: "failed", error: "no", result: { ok: false, error: "no" } });
    expect(ok.calls.filter(([s]) => s === "update").map(([, patch]) => patch)).toEqual([
      { status: "done", card_id: "k" },
      { status: "done", card_id: "k", result: { ok: true, cardId: "k" } },
      { status: "failed", error: "no" },
      { status: "failed", error: "no", result: { ok: false, error: "no" } },
    ]);
    const warn = vi.fn();
    await sessionLine(fakeClient({ error: { message: "denied" } }).client, "u1", "m", warn).report("c1", { status: "done", cardId: null });
    expect(warn).toHaveBeenCalledWith("couldn't report on c1: denied");
  });
});

describe("sessionLine leases", () => {
  it("renews its claimed rows by touching lease_until, which the database sets itself", async () => {
    const ok = fakeClient({ error: null });
    await sessionLine(ok.client, "u1", "m", vi.fn()).renew!(["c1", "c2"]);
    expect(ok.calls).toContainEqual(["in", "id", ["c1", "c2"]]);
    expect(ok.calls).toContainEqual(["eq", "status", "claimed"]);
    expect(ok.calls.find(([s]) => s === "update")?.[1]).toHaveProperty("lease_until");
    await expect(sessionLine(fakeClient({ error: { message: "no lease_until column" } }).client, "u1", "m", vi.fn()).renew!(["c1"])).rejects.toThrow("lease_until");
  });

  it("reclaims its device's expired claims of the verbs named, through the invoker function", async () => {
    const got = fakeClient({ data: 2, error: null });
    expect(await sessionLine(got.client, "u1", "mac-1", vi.fn()).reclaim!(["files.read"])).toBe(2);
    expect(got.calls).toContainEqual(["rpc", "reclaim_cloud_commands", { p_device: "mac-1", p_verbs: ["files.read"] }]);
    expect(await sessionLine(fakeClient({ data: null, error: null }).client, "u1", "m", vi.fn()).reclaim!([])).toBe(0);
    await expect(sessionLine(fakeClient({ data: null, error: { message: "does not exist" } }).client, "u1", "m", vi.fn()).reclaim!([])).rejects.toThrow("does not exist");
  });
});

describe("keyLine (a worker)", () => {
  const reg = () => ({ pending: vi.fn(() => Promise.resolve([row()])), claim: vi.fn(() => Promise.resolve(true)), report: vi.fn(() => Promise.resolve()) });

  it("reads and claims through its key", async () => {
    const r = reg();
    const line = keyLine(r);
    expect(await line.pending()).toEqual([row()]);
    expect(await line.claim("c1")).toBe(true);
    expect(r.claim).toHaveBeenCalledWith("c1");
  });

  it("reports with p_result only when there is one", async () => {
    const r = reg();
    const line = keyLine(r);
    await line.report("c1", { status: "done", cardId: "k" });
    await line.report("c1", { status: "failed", error: "no", result: { ok: false, error: "no" } });
    expect(r.report.mock.calls).toEqual([
      ["c1", "done", "k", null],
      ["c1", "failed", null, "no", { ok: false, error: "no" }],
    ]);
  });

  it("renews and reclaims through its key when the registry can, and leaves leases off when it can't", async () => {
    const renew = vi.fn(() => Promise.resolve());
    const reclaim = vi.fn(() => Promise.resolve(1));
    const line = keyLine({ ...reg(), renew, reclaim });
    await line.renew!(["c1"]);
    expect(await line.reclaim!(["files.read"])).toBe(1);
    expect(renew).toHaveBeenCalledWith(["c1"]);
    expect(reclaim).toHaveBeenCalledWith(["files.read"]);
    const bare = keyLine(reg());
    expect(bare.renew).toBeUndefined();
    expect(bare.reclaim).toBeUndefined();
  });
});
