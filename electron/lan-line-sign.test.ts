// Main's side of the LAN path (electron/lan-line-sign.cjs): a worker's pinned keys, only for one this Mac paired, and
// this Mac's device key over a message it builds itself, which the worker's port takes (lib/worker-lan.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { lanOfferMessage as tsMessage } from "../lib/lan-hint";
import { macSigned } from "../lib/worker-mac-keys";
import { lanLineRoutes, lanOfferMessage } from "./lan-line-sign.cjs";
import { fakeSafeStorage } from "./pairing.harness";
import { desktopSignerFor } from "./settings-sign.cjs";

const WORKER = "1a2b3c4d-0000-4000-8000-00000000abcd";
const DIGEST = "ab".repeat(32);
type Route = (body: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;

const pinsOf = (pins: Record<string, { publicKey?: string; signKey?: string }>) => () => ({ pinned: (id: string) => pins[id] ?? null });

describe("lanOfferMessage", () => {
  it("matches lib/lan-hint.ts", () => {
    expect(lanOfferMessage(WORKER, 12, "n", DIGEST)).toBe(tsMessage(WORKER, 12, "n", DIGEST));
  });
});

describe("POST /lan-line/keys", () => {
  it("answers the pinned sign and box keys of a paired worker, and nothing for any other", async () => {
    const routes = lanLineRoutes({ pins: pinsOf({ [WORKER]: { publicKey: "box", signKey: "sign" }, "1a2b3c4d-0000-4000-8000-000000000001": { publicKey: "box" } }), signer: vi.fn() });
    const keys = routes["POST /lan-line/keys"] as Route;
    expect(await keys({ workerId: WORKER.toUpperCase() })).toEqual({ signKey: "sign", boxKey: "box" });
    expect(await keys({ workerId: "1a2b3c4d-0000-4000-8000-000000000001" })).toEqual({});
    expect(await keys({ workerId: "1a2b3c4d-0000-4000-8000-000000000002" })).toEqual({});
    expect(() => keys({ workerId: "w1" })).toThrow("names no worker");
    expect(() => keys(null)).toThrow("names no worker");
  });
});

describe("POST /lan-line/sign", () => {
  it("signs with this Mac's device key, at its own time and nonce, in a way the worker's port takes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-lan-sign-"));
    try {
      const signer = desktopSignerFor(dir, () => fakeSafeStorage());
      const sign = lanLineRoutes({ pins: pinsOf({ [WORKER]: { publicKey: "box", signKey: "sign" } }), signer, now: () => 77 })["POST /lan-line/sign"] as Route;
      const stamp = (await sign({ workerId: WORKER, digest: DIGEST })) as { key: string; sig: string; issuedAt: number; nonce: string };
      expect(stamp.issuedAt).toBe(77);
      expect(stamp.nonce).toMatch(/^[0-9a-f]{32}$/);
      const device = (await signer()) as { publicKey: () => string };
      expect(stamp.key).toBe(device.publicKey());
      expect(macSigned(stamp.key, tsMessage(WORKER, 77, stamp.nonce, DIGEST), stamp.sig)).toBe(true);
      const again = (await sign({ workerId: WORKER, digest: DIGEST })) as { nonce: string };
      expect(again.nonce).not.toBe(stamp.nonce);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("signs nothing for a bad worker or digest, or a worker this Mac didn't pair, before the key opens", async () => {
    const signer = vi.fn();
    const sign = lanLineRoutes({ pins: pinsOf({ [WORKER]: { publicKey: "box" } }), signer })["POST /lan-line/sign"] as Route;
    await expect(sign({ workerId: "nope", digest: DIGEST })).rejects.toThrow("names no worker");
    await expect(sign({ workerId: WORKER, digest: "x" })).rejects.toThrow("names no offer");
    await expect(sign({ workerId: WORKER })).rejects.toThrow("names no offer");
    await expect(sign({ workerId: WORKER, digest: DIGEST })).rejects.toThrow("didn't pair that worker");
    expect(signer).not.toHaveBeenCalled();
  });

  it("uses the clock when none is given", async () => {
    const key = { publicKey: () => "k", sign: () => "s" };
    const sign = lanLineRoutes({ pins: pinsOf({ [WORKER]: { publicKey: "box", signKey: "sign" } }), signer: () => Promise.resolve(key) })["POST /lan-line/sign"] as Route;
    const before = Date.now();
    expect(((await sign({ workerId: WORKER, digest: DIGEST })) as { issuedAt: number }).issuedAt).toBeGreaterThanOrEqual(before);
  });
});
