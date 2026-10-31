// Shared stand-ins for the patcher's tests (patcher.test.ts, patcher-quiet.test.ts).
import crypto from "node:crypto";
import { vi } from "vitest";
import { signPatch } from "./server-patch-feed.cjs";
import { AWAY_SECONDS, createPatcher } from "./patcher.cjs";

// A throwaway ed25519 pair, made inside the test: nothing here is a real signing key.
export function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeyB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export const PAYLOAD = Buffer.from("the patch bytes");

// The details of the patch the fake feed publishes.
export const DETAILS = {
  version: "0.6.7",
  build: "0.6.7+abc123",
  seq: 12,
  deps: "deps-hash",
  url: "https://github.com/aimhuge/weft/releases/download/patch-latest/weft-server-0.6.7+abc123.tar.gz",
  sha256: crypto.createHash("sha256").update(PAYLOAD).digest("hex"),
  size: PAYLOAD.length,
};

// A patcher with every side effect a fake: the feed, the download, staging, the server's thread count.
export function make(over: Record<string, unknown> = {}) {
  const keys = keyPair();
  const calls = {
    fetchJson: vi.fn(() => Promise.resolve(signPatch(DETAILS, keys.privateKeyB64))),
    download: vi.fn(() => Promise.resolve(PAYLOAD)),
    stage: vi.fn(() => ({ build: DETAILS.build, seq: DETAILS.seq })),
    countRunning: vi.fn(() => Promise.resolve(0)),
    idleSeconds: vi.fn(() => AWAY_SECONDS),
    applyNow: vi.fn(() => Promise.resolve()),
    restartWhenIdle: vi.fn(() => Promise.resolve()),
    ask: vi.fn(() => Promise.resolve<string | null>(null)),
    notify: vi.fn(),
    busy: vi.fn(() => false),
    onChange: vi.fn(),
    log: { warn: vi.fn() } as unknown as Console,
  };
  const patcher = createPatcher({
    currentVersion: "0.6.7",
    packaged: true,
    publicKey: keys.publicKeyB64,
    readLocal: () => ({ deps: "deps-hash", activeSeq: 0, bad: [] }),
    ...calls,
    ...over,
  });
  return { patcher, keys, ...calls };
}
