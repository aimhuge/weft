import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { devEnvOnWorker } from "./worker-dev-env";
import { deliverSecretUse, openAsk } from "./worker-secret-asks";
import { redactOnWorker } from "./worker-secret-run";
import { newSealKeys, open, type Sealed } from "./worker-seal";
import type { VaultDeps } from "./worker-vault";
import { DEV_ENV, devEnvPurpose, vaultAskMessage } from "./worker-vault-wire";

const keys = newSealKeys();
const mac = macSigner();
const macs = memoryMacs([mac.key]);
const pair = crypto.generateKeyPairSync("ed25519");
const sign = (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64");
let n = 0;

// What the Mac sends once the user allows: the vault's development set, sealed for this card's dev server.
function deliver(card: string, nonce: string, command: string, values: Record<string, string>) {
  const plain = { v: 1, card, nonce, command, names: Object.keys(values), environment: "development", expiresAt: Date.now() + 60_000, values };
  const sealed: Sealed = cjs.seal(keys.publicKey, JSON.stringify(plain), devEnvPurpose(card, nonce, command));
  return deliverSecretUse({ payload: { cardId: card, nonce, sealed, mac: mac.mac(card, nonce, sealed), use: "dev" } as never }, (s, purpose) => open(keys, s, purpose), macs);
}

function deps(answer: (args: Record<string, unknown>) => Record<string, unknown>) {
  const nonce = String(++n).padStart(64, "0");
  const asked: Record<string, unknown>[] = [];
  const d: Partial<VaultDeps> & { waitMs?: number; runner?: string } = {
    link: { sign, boxKey: keys.publicKey, macKey: () => mac.key },
    ask: (_card, tool, args) => {
      asked.push({ tool, ...args });
      return Promise.resolve(answer(args));
    },
    remote: () => Promise.resolve("git@github.com:o/r.git"),
    now: () => Date.now(),
    nonce: () => nonce,
    runner: "/weft/electron/secret-env.cjs",
  };
  return { d, asked, nonce };
}

const req = (card: string) => ({ cardId: card, thread: "Fix", root: "/w/proj", cwd: "/w/proj/app", command: "pnpm dev", argv: ["pnpm", "dev"], env: { PORT: "3000" }, script: "dev: next dev" });

describe("devEnvOnWorker", () => {
  it("asks the Mac with a signed dev_env call, then launches with the sealed values on the runner's stdin", async () => {
    const { d, asked, nonce } = deps(() => {
      setTimeout(() => deliver("d1", nonce, "pnpm dev", { API_KEY: "sk-dev-123456" }), 0);
      return { queued: true, names: ["API_KEY"] };
    });
    const r = await devEnvOnWorker(req("d1"), d);
    expect(r.launch).toEqual({ bin: process.execPath, args: ["/weft/electron/secret-env.cjs"], env: {}, stdin: JSON.stringify({ values: { API_KEY: "sk-dev-123456" }, argv: ["pnpm", "dev"], env: { PORT: "3000" } }), names: ["API_KEY"] });
    const { tool, sig, thread, ...signed } = asked[0] ?? {};
    expect(tool).toBe(DEV_ENV);
    expect(thread).toBe("Fix");
    expect(signed).toMatchObject({ command: "pnpm dev", cwd: "app", script: "dev: next dev", nonce });
    expect(crypto.verify(null, Buffer.from(vaultAskMessage("d1", keys.publicKey, DEV_ENV, signed as never)), pair.publicKey, Buffer.from(String(sig), "base64"))).toBe(true);
    // Kept for the card's stored text to be redacted, and the ask closed.
    expect(await redactOnWorker("d1", "x sk-dev-123456")).toBe("x ‹API_KEY›");
    expect(() => deliver("d1", nonce, "pnpm dev", { API_KEY: "again" })).toThrow("answers no open ask");
  });

  it("starts plainly when the Mac says no, or the vault has no development values", async () => {
    expect(await devEnvOnWorker(req("d2"), deps(() => ({ denied: true })).d)).toEqual({ note: "Started without vault secrets: not approved on your Mac." });
    expect(await devEnvOnWorker(req("d2"), deps(() => ({ none: true })).d)).toEqual({});
  });

  it("says why when the values never come, the Mac can't be asked, or the card already has an ask open", async () => {
    const late = deps(() => ({ queued: true }));
    expect(await devEnvOnWorker(req("d3"), { ...late.d, waitMs: 5 })).toEqual({ note: "Started without vault secrets: Your Mac approved the dev server's secrets, but they didn't arrive." });
    const away = deps(() => {
      throw new Error("no Mac answered");
    });
    expect(await devEnvOnWorker(req("d3"), away.d)).toEqual({ note: "Started without vault secrets: no Mac answered" });
    const held = openAsk("f".repeat(64), { cardId: "d4", command: "x", names: ["A"], environment: "development", expiresAt: Date.now() + 1_000 });
    expect((await devEnvOnWorker(req("d4"), deps(() => ({})).d)).note).toContain("already has a secret ask waiting");
    held.drop();
  });

  it("names the cwd as the checkout itself, and uses the real clock and runner by default", async () => {
    const { d, asked } = deps(() => ({ none: true }));
    delete d.now;
    delete d.runner;
    await devEnvOnWorker({ ...req("d5"), cwd: "/w/proj" }, d);
    expect(asked[0]?.cwd).toBe(".");
  });
});

describe("devEnvOnWorker's defaults", () => {
  it("makes its own nonce and launches through electron/secret-env.cjs beside it", async () => {
    const asked: Record<string, unknown>[] = [];
    const d: Partial<VaultDeps> = {
      link: { sign, boxKey: keys.publicKey, macKey: () => mac.key },
      remote: () => Promise.resolve("r"),
      ask: (_card, _tool, args) => {
        asked.push(args);
        setTimeout(() => deliver("d6", String(args.nonce), "pnpm dev", { K: "v-123456" }), 0);
        return Promise.resolve({ queued: true });
      },
    };
    const r = await devEnvOnWorker(req("d6"), d);
    expect(String(asked[0]?.nonce)).toMatch(/^[0-9a-f]{64}$/);
    expect(r.launch?.args[0]).toMatch(/electron\/secret-env\.cjs$/);
  });
});
