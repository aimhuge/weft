import { describe, expect, it, vi } from "vitest";
import { DEV_OPEN_WAIT, openWorkerDev, stopWorkerDev } from "./worker-dev-acts";

vi.mock("./worker-acts", () => ({ ACT_WAIT: { every: () => 1, unclaimed: 10, claimed: 30 }, askWorker: vi.fn(), actOnWorker: vi.fn() }));

const ADDRESS = "https://weft.zip/t/0f8fad5b-d9cb-469f-a165-70867728950e";

describe("worker dev acts", () => {
  it("waits minutes for the address, since it takes a Touch ID", async () => {
    const ask = vi.fn(() => Promise.resolve({ ok: true, cardId: "c1", address: ADDRESS }));
    expect(await openWorkerDev("c1", ask as never)).toBe(ADDRESS);
    expect(ask).toHaveBeenCalledWith("dev.open", { id: "c1" }, DEV_OPEN_WAIT);
    expect(DEV_OPEN_WAIT.claimed).toBe(360_000);
  });

  it("says when no address came back", async () => {
    await expect(openWorkerDev("c1", () => Promise.resolve(null))).rejects.toThrow("didn't give");
  });

  it("refuses an address that isn't Weft's own /t/<id>, since the worker wrote it", async () => {
    for (const address of ["javascript:alert(1)", "https://evil.example/t/x", "https://weft.zip/t/t1"])
      await expect(openWorkerDev("c1", () => Promise.resolve({ address }))).rejects.toThrow("didn't give");
  });

  it("stops the card's run", async () => {
    const act = vi.fn(() => Promise.resolve(undefined));
    await stopWorkerDev("c1", act);
    expect(act).toHaveBeenCalledWith("dev.stop", { id: "c1" });
  });

  it("uses the real acts by default", async () => {
    const acts = await import("./worker-acts");
    vi.mocked(acts.askWorker).mockResolvedValue({ address: ADDRESS });
    expect(await openWorkerDev("c1")).toBe(ADDRESS);
    await stopWorkerDev("c1");
    expect(acts.actOnWorker).toHaveBeenCalled();
  });
});
