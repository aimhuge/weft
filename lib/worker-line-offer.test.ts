// A session line's offer from the desktop (lib/worker-board.ts openWorkerLine): sealed to the worker's published key
// under LINE_PURPOSE, on a `line` command addressed to that worker, and only for a worker of yours.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, workerRow } from "./worker-board.harness";
import { newSealKeys, open } from "./worker-seal";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("org-1") }));

const { openWorkerLine } = await import("./worker-board");

const offer = { sdp: "v=0", key: "k", topic: "worker-line:t", ice: [{ urls: "turn:t", username: "u", credential: "c" }] };
const keys = newSealKeys();

beforeEach(() => vi.clearAllMocks());

describe("openWorkerLine", () => {
  it("seals the offer, its key, topic and ICE servers to the worker and sends a line command", async () => {
    const { client, inserted } = fakeClient({ workers: [workerRow()], publicKey: keys.publicKey, insertId: "cmd-9" });
    await expect(openWorkerLine({ action: "line", workerId: "w1", offer }, client)).resolves.toEqual({ commandId: "cmd-9" });
    const row = inserted() as { kind: string; target_device: string; folder: string; payload: { sealed: never } };
    expect(row).toMatchObject({ org_id: "org-1", kind: "line", target_device: "worker:w1", folder: "" });
    expect(JSON.parse(open(keys, row.payload.sealed, "rtc-line"))).toEqual(offer);
    // Only as a line: the screen's purpose can't open it.
    expect(() => open(keys, row.payload.sealed, "rtc-offer")).toThrow();
  });

  it("refuses a worker that isn't yours, or one with no key yet", async () => {
    await expect(openWorkerLine({ action: "line", workerId: "w9", offer }, fakeClient({ workers: [workerRow()], publicKey: keys.publicKey }).client)).rejects.toThrow("isn't one of yours");
    await expect(openWorkerLine({ action: "line", workerId: "w1", offer }, fakeClient({ workers: [workerRow()], publicKey: null }).client)).rejects.toThrow("hasn't published its key");
    await expect(openWorkerLine({ action: "line", workerId: "w1", offer }, fakeClient({ user: null }).client)).rejects.toThrow("Sign in");
  });
});

describe("openWorkerLine over the LAN", () => {
  it("hands back a LAN answer and writes no row; with none, takes the row", async () => {
    const answer = { iv: "aXY=", ct: "Y3Q=" };
    const { client, inserted } = fakeClient({ workers: [workerRow()], publicKey: keys.publicKey, insertId: "cmd-9" });
    const lan = vi.fn(() => Promise.resolve(answer));
    await expect(openWorkerLine({ action: "line", workerId: "w1", offer }, client, lan)).resolves.toEqual({ answer });
    expect(lan).toHaveBeenCalledWith("w1", offer);
    expect(inserted()).toBeNull();
    await expect(openWorkerLine({ action: "line", workerId: "w1", offer }, client, () => Promise.resolve(null))).resolves.toEqual({ commandId: "cmd-9" });
  });
});
