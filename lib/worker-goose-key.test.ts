import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { usesSecrets } from "./secret-run";
import { gooseKeyOnWorker, type GooseKeyDeps } from "./worker-goose-key";
import { GOOSE_KEY, gooseKeyAskMessage, gooseKeyCommand, gooseKeyPurpose } from "./worker-goose-key-wire";
import { deliverSecretUse, openAsk } from "./worker-secret-asks";
import { redactOnWorker } from "./worker-secret-run";
import { newSealKeys, open, type Sealed } from "./worker-seal";
import { devEnvPurpose } from "./worker-vault-wire";

const keys = newSealKeys();
const mac = macSigner();
const macs = memoryMacs([mac.key]);
const pair = crypto.generateKeyPairSync("ed25519");
const sign = (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64");
const URL = "https://api-cli.puku.sh";
let n = 0;

// What the Mac sends once the user allows: the key, sealed for this card's Goose ask, provider and endpoint.
function deliver(card: string, nonce: string, values: Record<string, string>, over: { purpose?: string; command?: string } = {}) {
  const command = over.command ?? gooseKeyCommand("anthropic", URL);
  const plain = { v: 1, card, nonce, command, names: Object.keys(values), environment: "production", expiresAt: Date.now() + 60_000, values };
  const sealed: Sealed = cjs.seal(keys.publicKey, JSON.stringify(plain), over.purpose ?? gooseKeyPurpose(card, nonce, command));
  return deliverSecretUse({ payload: { cardId: card, nonce, sealed, mac: mac.mac(card, nonce, sealed), use: "goose" } as never }, (s, purpose) => open(keys, s, purpose), macs);
}

function deps(answer: (args: Record<string, unknown>) => Record<string, unknown>) {
  const nonce = String(++n).padStart(64, "0");
  const asked: Record<string, unknown>[] = [];
  const d: Partial<GooseKeyDeps> = {
    link: { sign, boxKey: keys.publicKey, macKey: () => mac.key },
    ask: (_card, tool, args) => {
      asked.push({ tool, ...args });
      return Promise.resolve(answer(args));
    },
    now: () => Date.now(),
    nonce: () => nonce,
  };
  return { d, asked, nonce };
}

const req = (card: string, providerId = "anthropic", baseUrl = URL) => ({ cardId: card, providerId, baseUrl });

afterEach(() => vi.restoreAllMocks());

describe("gooseKeyOnWorker", () => {
  it("asks the Mac with a signed goose_key call, and puts the sealed key in this Goose process's env only", async () => {
    const { d, asked, nonce } = deps(() => {
      setTimeout(() => deliver("g1", nonce, { ANTHROPIC_API_KEY: "sk-ant-123456" }), 0);
      return { queued: true };
    });
    const before = { ...process.env };
    expect(await gooseKeyOnWorker(req("g1"), d)).toEqual({ ANTHROPIC_API_KEY: "sk-ant-123456", ANTHROPIC_HOST: URL });
    expect(process.env).toEqual(before);
    const { tool, sig, ...signed } = asked[0] ?? {};
    expect(tool).toBe(GOOSE_KEY);
    expect(signed).toEqual({ nonce, expiresAt: expect.any(Number) as unknown, providerId: "anthropic", baseUrl: URL });
    expect(crypto.verify(null, Buffer.from(gooseKeyAskMessage("g1", keys.publicKey, signed as never)), pair.publicKey, Buffer.from(String(sig), "base64"))).toBe(true);
    // Redacted from the card's stored text until its turn ends, and the ask closed: a replay finds nothing.
    expect(usesSecrets("g1")).toBe(true);
    expect(await redactOnWorker("g1", "said sk-ant-123456")).toBe("said ‹ANTHROPIC_API_KEY›");
    expect(() => deliver("g1", nonce, { ANTHROPIC_API_KEY: "again" })).toThrow("answers no open ask");
  });

  it("won't open a key sealed for a run, a dev server or another endpoint", async () => {
    const refused: string[] = [];
    const tryDeliver = (...args: Parameters<typeof deliver>) => {
      try {
        deliver(...args);
      } catch (err) {
        refused.push((err as Error).message);
      }
    };
    const { d, nonce } = deps(() => {
      setTimeout(() => {
        const right = gooseKeyCommand("anthropic", URL);
        const evil = gooseKeyCommand("anthropic", "https://evil.example");
        tryDeliver("g2", nonce, { ANTHROPIC_API_KEY: "k" }, { purpose: devEnvPurpose("g2", nonce, right) });
        tryDeliver("g2", nonce, { ANTHROPIC_API_KEY: "k" }, { command: evil });
        tryDeliver("g2", nonce, { ANTHROPIC_API_KEY: "k" }, { command: evil, purpose: gooseKeyPurpose("g2", nonce, right) });
        tryDeliver("g2", nonce, { OPENAI_API_KEY: "k" });
      }, 0);
      return { queued: true };
    });
    await expect(gooseKeyOnWorker(req("g2"), { ...d, waitMs: 30 })).rejects.toThrow("didn't arrive");
    expect(refused).toEqual([
      "That secret use wasn't sealed to this worker for this card's command.",
      "That secret use wasn't sealed to this worker for this card's command.",
      "That secret use is for another command.",
      "That secret use names other secrets.",
    ]);
  });

  it("says why there's no key for a provider that needs one", async () => {
    await expect(gooseKeyOnWorker(req("g3"), deps(() => ({ denied: true })).d)).rejects.toThrow("Goose needs your Anthropic key from your Mac, and it wasn't approved there.");
    await expect(gooseKeyOnWorker(req("g3"), deps(() => ({ none: true })).d)).rejects.toThrow("There's no Anthropic key saved on your Mac.");
    await expect(gooseKeyOnWorker(req("g3"), deps(() => ({})).d)).rejects.toThrow("Your Mac didn't send your Anthropic key.");
    const unpaired = deps(() => ({ queued: true })).d;
    await expect(gooseKeyOnWorker(req("g3"), { ...unpaired, link: { boxKey: keys.publicKey, macKey: () => undefined } })).rejects.toThrow("enrolled by token");
    await expect(gooseKeyOnWorker(req("g3"), { ...unpaired, link: null })).rejects.toThrow("only your Mac has it");
    const held = openAsk("e".repeat(64), { cardId: "g4", command: "x", names: ["A"], environment: "development", expiresAt: Date.now() + 1_000 });
    await expect(gooseKeyOnWorker(req("g4"), deps(() => ({})).d)).rejects.toThrow("already has a secret ask waiting");
    held.drop();
  });

  it("starts a provider that may run keyless without a key when none comes, and saying so", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await gooseKeyOnWorker(req("g5", "litellm", "http://proxy:4000"), deps(() => ({ none: true })).d)).toBeUndefined();
    expect(said).toHaveBeenCalledWith(expect.stringContaining("Goose starts without a key: There's no LiteLLM key saved"));
  });

  it("asks nothing for a provider with no key (Ollama, Goose's own) or with no card", async () => {
    const { d, asked } = deps(() => ({ queued: true }));
    expect(await gooseKeyOnWorker(req("g6", "ollama", "http://localhost:11434"), d)).toBeUndefined();
    expect(await gooseKeyOnWorker(req("g6", "", ""), d)).toBeUndefined();
    expect(await gooseKeyOnWorker({ providerId: "anthropic", baseUrl: "" }, d)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("makes its own nonce and uses the real clock by default", async () => {
    const asked: Record<string, unknown>[] = [];
    const d: Partial<GooseKeyDeps> = {
      link: { sign, boxKey: keys.publicKey, macKey: () => mac.key },
      ask: (_card, _tool, args) => {
        asked.push(args);
        setTimeout(() => deliver("g7", String(args.nonce), { OPENAI_API_KEY: "sk-o-123456" }, { command: gooseKeyCommand("openai", "") }), 0);
        return Promise.resolve({ queued: true });
      },
    };
    expect(await gooseKeyOnWorker(req("g7", "openai", ""), d)).toEqual({ OPENAI_API_KEY: "sk-o-123456" });
    expect(String(asked[0]?.nonce)).toMatch(/^[0-9a-f]{64}$/);
  });
});
