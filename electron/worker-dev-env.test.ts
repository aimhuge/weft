// A worker's dev server env on main's side (electron/worker-dev-env.cjs): one Touch ID, then a standing grant for that
// worker, card, vault, command and script; the development set sealed to the pinned key, never a loader variable.
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describe as describeRun } from "./secret-run.cjs";
import { createWorkerDevEnv, GRANT_MS } from "./worker-dev-env.cjs";
import { secretUseMessage } from "../lib/secret-use";
import { macSigned } from "../lib/worker-mac-keys";
import { newSealKeys, open, type Sealed } from "../lib/worker-seal";
import { devEnvPurpose } from "../lib/worker-vault-wire";

const keys = newSealKeys();
const macPair = crypto.generateKeyPairSync("ed25519");
const macKey = Buffer.from(macPair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
const signer = () => Promise.resolve({ publicKey: () => macKey, sign: (m: string) => crypto.sign(null, Buffer.from(m), macPair.privateKey).toString("base64") });
const NONCE = "e".repeat(64);
let now = 1_000_000;

function setup(values: Record<string, string> = { API_KEY: "sk-dev-1", NODE_OPTIONS: "--require x" }, answer: string | null = "once") {
  const inserted: Record<string, unknown>[] = [];
  const supabase = { from: () => ({ insert: (row: Record<string, unknown>) => (inserted.push(row), Promise.resolve({ error: null })) }) };
  const ask = vi.fn<(request: { message: string }) => Promise<string | null>>(() => Promise.resolve(answer));
  const pins = { pin: vi.fn() };
  const audit = vi.fn();
  const vault = { valuesForVault: vi.fn(() => Promise.resolve({ values })) };
  const dev = createWorkerDevEnv({ vault, ask, describe: describeRun, pins, signer, audit, now: () => now });
  const ctx = (over: Record<string, unknown> = {}, pin: Record<string, unknown> = {}) => ({
    account: { supabase },
    row: { org_id: "org-1", card_id: "card-1" },
    worker: { id: "w1", name: "m1mini" },
    a: { nonce: NONCE, expiresAt: now + 60_000, remote: "r", command: "pnpm dev", cwd: ".", script: "dev: next dev", thread: "Fix", ...over },
    pin: { publicKey: keys.publicKey, fingerprint: "ab12", firstUse: false, signKey: "SK", ...pin },
    signKey: "SK",
    ref: { id: "github:o/r", label: "o/r" },
  });
  return { dev, ctx, ask, pins, audit, inserted, vault };
}

beforeEach(() => {
  now = 1_000_000;
});

describe("createWorkerDevEnv", () => {
  it("asks once, then seals the development set (no loader variable) to the pinned key as a Mac-signed dev secret_use", async () => {
    const s = setup();
    expect(await s.dev.answer(s.ctx())).toEqual({ queued: true, names: ["API_KEY"], label: "o/r" });
    expect(s.ask.mock.calls[0]?.[0]).toMatchObject({ message: "Start a dev server on the worker m1mini with o/r's development secrets?" });
    expect(s.vault.valuesForVault).toHaveBeenCalledWith({ id: "github:o/r", label: "o/r" }, null, "development", false);
    const sent = s.inserted[0] as { kind: string; target_device: string; payload: { use: string; cardId: string; nonce: string; sealed: Sealed; mac: { key: string; sig: string } } };
    expect(sent).toMatchObject({ kind: "secret_use", target_device: "worker:w1", payload: { use: "dev", cardId: "card-1", nonce: NONCE } });
    expect(JSON.stringify(sent)).not.toContain("sk-dev-1");
    expect(macSigned(sent.payload.mac.key, secretUseMessage("card-1", NONCE, sent.payload.sealed), sent.payload.mac.sig)).toBe(true);
    const opened = JSON.parse(open(keys, sent.payload.sealed, devEnvPurpose("card-1", NONCE, "pnpm dev"))) as Record<string, unknown>;
    expect(opened).toMatchObject({ card: "card-1", names: ["API_KEY"], environment: "development", values: { API_KEY: "sk-dev-1" } });
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "worker dev server", via: "once", outcome: "ok" }));
    expect(s.pins.pin).not.toHaveBeenCalled();
  });

  it("restarts under the standing grant without asking, until it runs out or the command changes", async () => {
    const s = setup();
    await s.dev.answer(s.ctx());
    expect(await s.dev.answer(s.ctx())).toMatchObject({ queued: true });
    expect(s.ask).toHaveBeenCalledTimes(1);
    expect(s.audit).toHaveBeenLastCalledWith(expect.objectContaining({ via: "grant" }));
    await s.dev.answer(s.ctx({ command: "pnpm start" }));
    await s.dev.answer(s.ctx({ script: "dev: next dev --turbo" }));
    expect(s.ask).toHaveBeenCalledTimes(3);
    now += GRANT_MS + 1;
    await s.dev.answer(s.ctx());
    expect(s.ask).toHaveBeenCalledTimes(4);
    s.dev.forgetWorker("w1");
    await s.dev.answer(s.ctx());
    expect(s.ask).toHaveBeenCalledTimes(5);
  });

  it("pins a first-seen key with the Allow", async () => {
    const s = setup();
    await s.dev.answer(s.ctx({}, { firstUse: true }));
    expect(s.pins.pin).toHaveBeenCalledWith("w1", { name: "m1mini", publicKey: keys.publicKey, signKey: "SK" });
  });

  it("answers denied, none, and an ask that expired while it waited", async () => {
    const no = setup(undefined, null);
    expect(await no.dev.answer(no.ctx())).toEqual({ denied: true, label: "o/r" });
    expect(no.inserted).toEqual([]);
    expect(no.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }));
    const empty = setup({ NODE_OPTIONS: "x" });
    expect(await empty.dev.answer(empty.ctx())).toEqual({ none: true, label: "o/r" });
    expect(empty.ask).not.toHaveBeenCalled();
    const slow = setup();
    await expect(slow.dev.answer(slow.ctx({ expiresAt: now - 1 }))).rejects.toThrow("expired while it waited");
  });
});
