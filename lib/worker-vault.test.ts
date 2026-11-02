import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askVault, blankOnWorker, listOnWorker, pushOnWorker, setOnWorker, setVaultLink, UNPAIRED, type VaultDeps } from "./worker-vault";
import { VAULT_BLANK, VAULT_LIST, VAULT_PUSH, vaultAskMessage } from "./worker-vault-wire";

const pair = crypto.generateKeyPairSync("ed25519");
const sign = (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64");
const verify = (m: string, sig: string) => crypto.verify(null, Buffer.from(m), pair.publicKey, Buffer.from(sig, "base64"));
const NONCE = "b".repeat(64);

function deps(answer: Record<string, unknown> = {}, over: Partial<VaultDeps> = {}) {
  const asked: { cardId?: string; tool: string; args: Record<string, unknown> }[] = [];
  const d: Partial<VaultDeps> = {
    link: { sign, boxKey: "BOX", macKey: () => "MAC" },
    ask: (cardId, tool, args) => {
      asked.push({ cardId, tool, args });
      return Promise.resolve(answer);
    },
    remote: () => Promise.resolve("git@github.com:o/r.git"),
    now: () => 1_000,
    nonce: () => NONCE,
    seal: (key, text) => Promise.resolve(`sealed(${key}):${text}`),
    ...over,
  };
  return { d, asked, args: (i = 0) => asked[i]?.args ?? {} };
}

afterEach(() => setVaultLink(null));

describe("askVault", () => {
  it("signs every field the Mac acts on with the pairing key, naming the box key", async () => {
    const { d, args: argsOf } = deps({ ok: true });
    expect(await askVault("c1", "/w/p", VAULT_BLANK, { names: ["A"], environment: "development", thread: "T", why: "W" }, d)).toEqual({ ok: true });
    const args = argsOf();
    expect(args).toMatchObject({ nonce: NONCE, expiresAt: 1_000 + 5 * 60_000, remote: "git@github.com:o/r.git", names: ["A"], thread: "T" });
    const { sig, ...signed } = args;
    expect(verify(vaultAskMessage("c1", "BOX", VAULT_BLANK, signed as never), String(sig))).toBe(true);
  });

  it("says why it can't ask", async () => {
    await expect(askVault(undefined, "/w", VAULT_LIST, {}, deps().d)).rejects.toThrow("Only a card's thread");
    await expect(askVault("c", "/w", VAULT_LIST, {}, { ...deps().d, link: null })).rejects.toThrow("can't reach your Mac's vault yet");
    await expect(askVault("c", "/w", VAULT_LIST, {}, { ...deps().d, link: { boxKey: "B", macKey: () => undefined } })).rejects.toThrow(UNPAIRED);
    await expect(askVault("c", "/w", VAULT_LIST, {}, { ...deps().d, remote: () => Promise.resolve(null) })).rejects.toThrow("no git remote");
  });

  it("uses the link the daemon set", async () => {
    const ask = vi.fn(() => Promise.resolve({}));
    setVaultLink({ sign, boxKey: "SET", macKey: () => undefined });
    await askVault("c", "/w", VAULT_LIST, {}, { ask, remote: () => Promise.resolve("r"), now: () => 0, nonce: () => NONCE });
    const args = (ask.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const { sig, ...signed } = args;
    expect(verify(vaultAskMessage("c", "SET", VAULT_LIST, signed as never), String(sig))).toBe(true);
  });
});

describe("the tools' calls", () => {
  it("lists names only, dropping anything that isn't one", async () => {
    const { d, asked } = deps({ label: "o/r", secrets: [{ name: "A", environment: "development", missing: true }, { name: "B", environment: "preview" }, { value: "x" }, null] });
    expect(await listOnWorker("c", "/w", d)).toEqual({ label: "o/r", secrets: [{ name: "A", environment: "development", missing: true }, { name: "B", environment: "preview", missing: false }] });
    expect(asked[0]?.tool).toBe(VAULT_LIST);
    expect((await listOnWorker("c", "/w", deps({}).d)).secrets).toEqual([]);
  });

  it("adds blanks with a hint, and reports the names that had values", async () => {
    const { d, asked } = deps({ label: "o/r", filled: ["B", 3] });
    expect(await blankOnWorker("c", "/w", ["A", "B"], "preview", "Stripe → keys", d)).toEqual({ label: "o/r", filled: ["B"] });
    expect(asked[0]).toMatchObject({ tool: VAULT_BLANK, args: { names: ["A", "B"], environment: "preview", hint: "Stripe → keys" } });
    const plain = deps({});
    expect(await blankOnWorker("c", "/w", ["A"], "development", undefined, plain.d)).toEqual({ label: "", filled: [] });
    expect(plain.args()).not.toHaveProperty("hint");
  });

  it("seals set_value's value to the paired Mac, bound to the card and the ask", async () => {
    const { d, asked, args: argsOf } = deps({ added: true });
    expect(await setOnWorker("c", "/w", { name: "S", value: "v4lue", environment: "development" }, d)).toEqual({ added: true });
    const args = argsOf();
    expect(args).toMatchObject({ name: "S", environment: "development", replace: false, nonce: NONCE });
    expect(String(args.sealed)).toBe(`sealed(MAC):${JSON.stringify({ v: 1, card: "c", nonce: NONCE, name: "S", environment: "development", value: "v4lue" })}`);
    expect(JSON.stringify({ ...args, sealed: "" })).not.toContain("v4lue");
    await setOnWorker("c", "/w", { name: "S", value: "v", environment: "development", replace: true }, d);
    expect(argsOf(1).replace).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it("won't seal a value with no Mac to seal it to", async () => {
    await expect(setOnWorker("c", "/w", { name: "S", value: "v", environment: "development" }, { ...deps().d, link: { sign, boxKey: "B", macKey: () => undefined } })).rejects.toThrow("trusts no Mac");
    await expect(setOnWorker("c", "/w", { name: "S", value: "v", environment: "development" }, { ...deps().d, link: { boxKey: "B", macKey: () => undefined } })).rejects.toThrow(UNPAIRED);
    await expect(setOnWorker("c", "/w", { name: "S", value: "v", environment: "development" }, { ...deps().d, link: null })).rejects.toThrow(UNPAIRED);
    await expect(setOnWorker(undefined, "/w", { name: "S", value: "v", environment: "development" }, deps().d)).rejects.toThrow("Only a card's thread");
  });

  it("asks the Mac to push", async () => {
    const { d, asked } = deps({ project: "web" });
    expect(await pushOnWorker("c", "/w", "S", "production", d)).toEqual({ project: "web" });
    expect(asked[0]).toMatchObject({ tool: VAULT_PUSH, args: { name: "S", environment: "production" } });
  });
});
