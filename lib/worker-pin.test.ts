import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => ({}) }));
const workers = vi.hoisted(() => vi.fn(() => Promise.resolve([{ id: "w1" }])));
vi.mock("./worker-board", () => ({ requireSession: () => Promise.resolve({ uid: "u", org: "o1" }), myWorkers: workers }));
const { pinWorkerPasskeys } = await import("./worker-pin");

function client(error: { message: string } | null = null) {
  const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(error ? { data: null, error } : { data: { id: "cmd-1" }, error: null }) }) }));
  return { c: { from: () => ({ insert }) } as never, insert };
}

describe("pinWorkerPasskeys", () => {
  it("inserts the endorsements as a pin command for one of your workers", async () => {
    const { c, insert } = client();
    expect(await pinWorkerPasskeys({ action: "pin", workerId: "w1", endorsements: [{ e: 1 }] }, c)).toEqual({ commandId: "cmd-1" });
    expect(insert).toHaveBeenCalledWith({ org_id: "o1", kind: "pin", target_device: "worker:w1", folder: "-", payload: { endorsements: [{ e: 1 }] } });
  });

  it("refuses none, too many, another's worker, and says when the insert fails", async () => {
    await expect(pinWorkerPasskeys({ action: "pin", workerId: "w1", endorsements: [] }, client().c)).rejects.toThrow(/no passkeys/);
    await expect(pinWorkerPasskeys({ action: "pin", workerId: "w1", endorsements: Array(21).fill({}) as unknown[] }, client().c)).rejects.toThrow(/no passkeys/);
    await expect(pinWorkerPasskeys({ action: "pin", workerId: "w9", endorsements: [{}] }, client().c)).rejects.toThrow(/isn't one of yours/);
    await expect(pinWorkerPasskeys({ action: "pin", workerId: "w1", endorsements: [{}] }, client({ message: "rls" }).c)).rejects.toThrow(/rls/);
    await expect(pinWorkerPasskeys({ action: "pin", workerId: "w1", endorsements: "x" as never })).rejects.toThrow(/no passkeys/);
  });
});
