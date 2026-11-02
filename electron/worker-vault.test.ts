// Main's side of a worker card's vault calls (electron/worker-vault.cjs): it reads the row itself, needs the pinned sign
// key's signature over everything it acts on, answers from the vault the card's own project names through this Mac's
// clone, and lets no value out: list is names, set_value's value comes in sealed to this Mac and is held to the row.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerPins } from "./worker-pins.cjs";
import { createWorkerVault, openedValue } from "./worker-vault.cjs";
import { vaultAskOf } from "./worker-vault-ask.cjs";
import { vaultAskMessage } from "../lib/worker-vault-wire";
import { newSealKeys } from "../lib/worker-seal";

const NOW = 1_000_000;
const NONCE = "c".repeat(64);
const keys = newSealKeys();
const sign = crypto.generateKeyPairSync("ed25519");
const SIGN_KEY = sign.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const REMOTE = "git@github.com:Aimhuge/Weft.git";
const base = (over: Record<string, unknown> = {}) => ({ nonce: NONCE, expiresAt: NOW + 60_000, remote: REMOTE, ...over });
const signed = (tool: string, a: Record<string, unknown>, card = "card-1") => ({ ...a, sig: crypto.sign(null, Buffer.from(vaultAskMessage(card, keys.publicKey, tool, a as never)), sign.privateKey).toString("base64") });
const plainStore = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
// A pinned, paired worker: box key and sign key, as pairing leaves them.
function pinned() {
  const pins = createWorkerPins({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-vault-pins-")), safeStorage: plainStore });
  pins.pin("w1", { name: "m1mini", publicKey: keys.publicKey, signKey: SIGN_KEY });
  return pins;
}

type Setup = { cardOrigin?: (...args: unknown[]) => Promise<void>; card?: Record<string, unknown>; tool?: string; args?: Record<string, unknown>; worker?: Record<string, unknown>; pins?: ReturnType<typeof createWorkerPins>; folders?: { path: string; id: string }[]; vercel?: boolean; open?: (s: string) => string; status?: string };
function setup({ cardOrigin, card = { folder: "weft" }, tool = "vault_list", args, worker, pins = pinned(), folders = [{ path: "/Users/me/dev/weft", id: "github:aimhuge/weft" }], vercel = true, open = (s) => Buffer.from(s, "base64").toString(), status = "claimed" }: Setup = {}) {
  const row = { id: "call-1", org_id: "org-1", owner_user: "u1", worker_id: "w1", card_id: "card-1", tool, args: args ?? signed(tool, base()), status };
  const data: Record<string, unknown> = { device_calls: row, cloud_workers: { id: "w1", name: "m1mini", owner_user: "u1", public_key: keys.publicKey, sign_key: SIGN_KEY, ...worker }, cloud_cards: card };
  const chain = (table: string) => {
    const q = { eq: () => q, maybeSingle: () => Promise.resolve({ data: data[table] }) };
    return q;
  };
  const supabase = { from: (table: string) => ({ select: () => chain(table) }) };
  const vault = {
    names: vi.fn(() => Promise.resolve({ label: "Aimhuge/Weft", secrets: [{ name: "A", environment: "development", missing: false, value: "never" }, { name: "B", environment: "preview", missing: true }] })),
    addBlanks: vi.fn(() => Promise.resolve({ label: "Aimhuge/Weft", filled: ["B"] })),
    confirm: vi.fn(() => Promise.resolve(true)),
    setValue: vi.fn(() => Promise.resolve()),
  };
  const push = vi.fn(() => Promise.resolve({ ok: true, label: "Aimhuge/Weft" }));
  const devEnv = { answer: vi.fn(() => Promise.resolve({ queued: true })) };
  const audit = vi.fn();
  const wv = createWorkerVault({ vault, vercelEnv: () => (vercel ? { push } : null), accountClient: () => ({ supabase, getClaims: () => ({ sub: "u1" }) }), pins, signer: () => Promise.resolve({ openBox: open }), projectFolders: () => Promise.resolve(folders), devEnv, ...(cardOrigin ? { cardOrigin } : {}), audit, now: () => NOW });
  return { wv, vault, push, devEnv, audit };
}

const sealedFor = (over: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ v: 1, card: "card-1", nonce: NONCE, name: "SIGNING", environment: "development", value: "gen3rated", ...over })).toString("base64");

beforeEach(() => vi.clearAllMocks());

describe("createWorkerVault", () => {
  it("lists names only, from the vault the card's remote names, through this Mac's clone", async () => {
    const s = setup();
    expect(await s.wv.answer("call-1")).toEqual({ label: "Aimhuge/Weft", secrets: [{ name: "A", environment: "development", missing: false }, { name: "B", environment: "preview", missing: true }] });
    expect(s.vault.names).toHaveBeenCalledWith("/Users/me/dev/weft");
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "worker list", worker: "m1mini", vault: "Aimhuge/Weft" }));
  });

  it("adds blanks, naming the worker as their source", async () => {
    const s = setup({ tool: "vault_blank", args: signed("vault_blank", base({ names: ["A", "B"], environment: "preview", hint: "Stripe keys" })) });
    expect(await s.wv.answer("call-1")).toEqual({ label: "Aimhuge/Weft", filled: ["B"] });
    expect(s.vault.addBlanks).toHaveBeenCalledWith("/Users/me/dev/weft", ["A", "B"], ["preview"], { source: "a thread on the worker m1mini", hint: "Stripe keys" });
    // The same signed ask again (a copy in a new row) is answered once only.
    await expect(s.wv.answer("call-1")).rejects.toThrow("already answered");
    const empty = setup({ tool: "vault_blank", args: signed("vault_blank", base({ names: ["A"], environment: "preview" })) });
    empty.vault.addBlanks.mockResolvedValueOnce(null as never);
    expect(await empty.wv.answer("call-1")).toEqual({ label: undefined, filled: [] });
  });

  it("answers only a card its owner started, after the signature and before the vault", async () => {
    const cardOrigin = vi.fn(() => Promise.reject(new Error("only answers the vault for a worker card you started")));
    const s = setup({ cardOrigin });
    await expect(s.wv.answer("call-1")).rejects.toThrow("card you started");
    expect(cardOrigin).toHaveBeenCalledWith(expect.anything(), "u1", "w1", "card-1", "weft");
    expect(s.vault.names).not.toHaveBeenCalled();
  });

  it("answers nothing for a worker revoked since it asked", async () => {
    const s = setup({ worker: { revoked_at: "2026-11-02T00:00:00Z" } });
    await expect(s.wv.answer("call-1")).rejects.toThrow("m1mini was revoked.");
  });

  it("opens set_value's sealed value and stores it after a Touch ID that names the worker", async () => {
    const s = setup({ tool: "vault_set", args: signed("vault_set", base({ name: "SIGNING", environment: "development", replace: false, sealed: sealedFor() })) });
    expect(await s.wv.answer("call-1")).toEqual({ ok: true, added: true, label: "Aimhuge/Weft" });
    expect(s.vault.confirm).toHaveBeenCalledWith("let a thread on the worker m1mini add SIGNING (Aimhuge/Weft, development). Value sha256 f0b733fb…");
    expect(s.vault.setValue).toHaveBeenCalledWith("/Users/me/dev/weft", "SIGNING", "development", "gen3rated", { source: "a thread on the worker m1mini", by: "thread" });
    expect(JSON.stringify(s.audit.mock.calls)).not.toContain("gen3rated");
  });

  it("refuses a value sealed for another ask, or not to this Mac", async () => {
    const other = setup({ tool: "vault_set", args: signed("vault_set", base({ name: "SIGNING", environment: "development", sealed: sealedFor({ card: "card-2" }) })) });
    await expect(other.wv.answer("call-1")).rejects.toThrow("That value wasn't sealed for this ask.");
    const elsewhere = setup({ tool: "vault_set", args: signed("vault_set", base({ name: "SIGNING", environment: "development", sealed: sealedFor() })), open: () => { throw new Error("bad"); } });
    await expect(elsewhere.wv.answer("call-1")).rejects.toThrow("wasn't sealed to this Mac");
    expect(other.vault.setValue).not.toHaveBeenCalled();
  });

  it("names the card and warns on a production value", async () => {
    const s = setup({ tool: "vault_set", args: signed("vault_set", base({ name: "SIGNING", environment: "production", replace: true, sealed: sealedFor({ environment: "production" }) })), card: { folder: "weft", title: "Fix\u202e login\n" } });
    await s.wv.answer("call-1");
    expect(s.vault.confirm).toHaveBeenCalledWith("let a thread on the worker m1mini add SIGNING (Aimhuge/Weft, production). This is the PRODUCTION value. Value sha256 f0b733fb…. Card: \"Fix login\"");
  });

  it("pushes to Vercel through this Mac's linked clone, naming the worker", async () => {
    const s = setup({ tool: "vault_push", args: signed("vault_push", base({ name: "KEY", environment: "production" })) });
    expect(await s.wv.answer("call-1")).toEqual({ ok: true, label: "Aimhuge/Weft" });
    expect(s.push).toHaveBeenCalledWith("/Users/me/dev/weft", "KEY", "production", "", "on the worker m1mini", "");
    const titled = setup({ tool: "vault_push", args: signed("vault_push", base({ name: "KEY", environment: "preview" })), card: { folder: "weft", title: "Ship it" } });
    await titled.wv.answer("call-1");
    expect(titled.push).toHaveBeenCalledWith("/Users/me/dev/weft", "KEY", "preview", "", "on the worker m1mini", 'Card: "Ship it"');
    await expect(setup({ tool: "vault_push", args: signed("vault_push", base({ name: "KEY", environment: "production" })), vercel: false }).wv.answer("call-1")).rejects.toThrow("Vercel isn't set up");
  });

  it("hands a dev server's ask to the dev env, with what it checked", async () => {
    const s = setup({ tool: "dev_env", args: signed("dev_env", base({ command: "pnpm dev", cwd: ".", script: "dev: next dev", thread: "Fix" })) });
    expect(await s.wv.answer("call-1")).toEqual({ queued: true });
    expect(s.devEnv.answer).toHaveBeenCalledWith(expect.objectContaining({ local: "/Users/me/dev/weft", signKey: SIGN_KEY, ref: { id: "github:aimhuge/weft", label: "Aimhuge/Weft" }, a: expect.objectContaining({ command: "pnpm dev", thread: "Fix" }) as unknown }));
    expect(s.audit).not.toHaveBeenCalled();
  });

  it("needs the pinned sign key's signature over what it acts on", async () => {
    await expect(setup({ args: base() }).wv.answer("call-1")).rejects.toThrow("That ask isn't signed by the worker's pinned key.");
    await expect(setup({ tool: "vault_blank", args: { ...signed("vault_blank", base({ names: ["A"], environment: "development" })), names: ["B"] } }).wv.answer("call-1")).rejects.toThrow("isn't signed");
    // Signed for list, sent as a blank: the tool is in the message.
    await expect(setup({ tool: "vault_push", args: { ...signed("vault_list", base()), name: "K", environment: "production" } }).wv.answer("call-1")).rejects.toThrow("isn't signed");
    const tokenPins = createWorkerPins({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-vault-pins-")), safeStorage: plainStore });
    await expect(setup({ pins: tokenPins }).wv.answer("call-1")).rejects.toThrow("no pinned signing key");
    await expect(setup({ worker: { sign_key: "other" } }).wv.answer("call-1")).rejects.toThrow("signing key changed");
  });

  it("refuses another project's vault, a project this Mac doesn't have, an answered row, and a signed-out Mac", async () => {
    await expect(setup({ args: signed("vault_list", base({ remote: "git@github.com:someone/else.git" })) }).wv.answer("call-1")).rejects.toThrow("A card only gets its own project's secrets.");
    await expect(setup({ folders: [] }).wv.answer("call-1")).rejects.toThrow("This Mac doesn't know which repo");
    await expect(setup({ status: "done" }).wv.answer("call-1")).rejects.toThrow("already answered");
    const out = createWorkerVault({ vault: {}, vercelEnv: () => null, accountClient: () => null, pins: pinned(), signer: () => Promise.reject(new Error("x")), projectFolders: () => Promise.resolve([]), devEnv: { answer: vi.fn() } });
    await expect(out.answer("call-1")).rejects.toThrow("Sign in to Weft on this Mac");
  });
});

describe("openedValue", () => {
  it("takes only this ask's value", () => {
    const row = { card_id: "card-1" };
    const a = { nonce: NONCE, name: "SIGNING", environment: "development" };
    const text = (over: Record<string, unknown> = {}) => Buffer.from(sealedFor(over), "base64").toString();
    expect(openedValue(text(), row, a)).toBe("gen3rated");
    for (const over of [{ v: 2 }, { nonce: "d".repeat(64) }, { name: "OTHER" }, { environment: "production" }, { value: "" }, { value: 3 }]) expect(() => openedValue(text(over), row, a)).toThrow("wasn't sealed for this ask");
    expect(() => openedValue("not json", row, a)).toThrow("wasn't sealed for this ask");
  });
});

describe("vaultAskOf", () => {
  it("keeps each tool's own fields, checked", () => {
    expect(vaultAskOf("vault_list", { ...base(), names: ["X"], sig: "s" }, NOW)).toEqual({ ...base(), sig: "s" });
    expect(vaultAskOf("vault_blank", base({ names: ["A"], environment: "preview" }), NOW)).toMatchObject({ names: ["A"], environment: "preview", hint: undefined });
    expect(vaultAskOf("vault_set", base({ name: "A", environment: "development", sealed: "AAAA" }), NOW)).toMatchObject({ replace: false, sealed: "AAAA" });
    expect(vaultAskOf("dev_env", base({ command: " pnpm dev ", thread: "x".repeat(200) }), NOW)).toMatchObject({ command: "pnpm dev", cwd: ".", script: undefined });
  });

  it.each([
    ["an unknown tool", "vault_read", base()],
    ["no nonce", "vault_list", base({ nonce: "x" })],
    ["no remote", "vault_list", base({ remote: undefined })],
    ["a list that isn't one", "vault_list", null],
    ["no names", "vault_blank", base({ environment: "development" })],
    ["too many names", "vault_blank", base({ names: Array.from({ length: 21 }, (_, i) => `N${i}`), environment: "development" })],
    ["a bad name", "vault_push", base({ name: "1A", environment: "development" })],
    ["a long name", "vault_push", base({ name: "A".repeat(201), environment: "development" })],
    ["an unknown environment", "vault_push", base({ name: "A", environment: "staging" })],
    ["no sealed value", "vault_set", base({ name: "A", environment: "development" })],
    ["an empty command", "dev_env", base({ command: "  " })],
    ["a command too long", "dev_env", base({ command: "x".repeat(5000) })],
  ])("refuses %s", (_what, tool, raw) => {
    expect(() => vaultAskOf(tool, raw, NOW)).toThrow("That vault ask isn't one Weft makes.");
  });

  it("refuses a name that loads code, a shell command, an expired ask and a hint it can't show", () => {
    expect(() => vaultAskOf("vault_set", base({ name: "NODE_OPTIONS", environment: "development", sealed: "AA" }), NOW)).toThrow("makes a program load code");
    expect(() => vaultAskOf("dev_env", base({ command: "pnpm dev && curl x" }), NOW)).toThrow();
    expect(() => vaultAskOf("vault_list", base({ expiresAt: NOW - 1 }), NOW)).toThrow("expired");
    expect(() => vaultAskOf("vault_blank", base({ names: ["A"], environment: "development", hint: "a‮b" }), NOW)).toThrow("hint");
  });
});
