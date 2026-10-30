import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";
import { createRequire } from "node:module";
import { vaultRoutes as rawRoutes } from "./vault-routes.cjs";

// vault-routes.cjs is CommonJS and loads the audit log through require, so the test drives the same
// instance of it (createRequire) rather than Vite's copy of the module.
const requireCjs = createRequire(import.meta.url);
const { audit, configureAudit, resetAudit } = requireCjs("./keychain-audit.cjs") as typeof import("./keychain-audit.cjs");

type Route = (body: Record<string, unknown>, route?: string) => Promise<unknown>;
const vaultRoutes = (get: () => unknown, cardFor: (body: Record<string, unknown>, route: string) => string = () => "c1") =>
  rawRoutes(get, cardFor) as unknown as {
    "POST /secrets/add-blank": Route;
    "POST /secrets/set": Route;
    "POST /secrets/ask-add": Route;
    "POST /secrets/request-access": Route;
    "POST /secrets/revoke-card": Route;
    "POST /secrets/audit-outbox": Route;
    "POST /secrets/audit-synced": Route;
  };

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};
const VALUE = "generated-signing-secret-0123456789abcdef";

function make(cardFor?: (body: Record<string, unknown>, route: string) => string) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
  const prompt = vi.fn(() => Promise.resolve(true));
  const onChange = vi.fn();
  const run = () => Promise.resolve("git@github.com:Owner/Repo.git");
  const clipboard = { writeText: vi.fn(), readText: () => "" };
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, onChange });
  const routes = vaultRoutes(() => vault, cardFor);
  const set = (body: Record<string, unknown>) => routes["POST /secrets/set"]({ folder, ...body });
  return { vault, folder, dataDir, prompt, onChange, routes, set };
}

describe("vaultRoutes", () => {
  it("says the vault isn't ready before main has one", () => {
    const routes = vaultRoutes(() => undefined);
    expect(() => routes["POST /secrets/set"]({ folder: "/x", name: "A", value: "v" })).toThrow(/isn't ready yet/);
    expect(() => routes["POST /secrets/add-blank"]({ folder: "/x", names: ["A"] })).toThrow(/isn't ready yet/);
  });

  it("adds blanks for a thread, development by default, with a short hint", async () => {
    const { routes, folder, vault } = make();
    expect(await routes["POST /secrets/add-blank"]({ folder, names: ["A"], hint: "x".repeat(500) })).toEqual({ label: "Owner/Repo", filled: [] });
    await expect(routes["POST /secrets/add-blank"]({ folder, names: "nope", environment: "production" })).rejects.toThrow(/Name at least one/);
    const [a] = (await vault.overview([folder])).vaults[0]!.secrets as { name: string; environment: string; source: string; hint: string }[];
    expect(a).toMatchObject({ name: "A", environment: "development", source: "a thread" });
    expect(a!.hint).toHaveLength(400);
  });

  it("fills a thread's blank with a value it generated, into the right environment, after a Touch ID", async () => {
    const { routes, folder, vault, set, prompt, onChange, dataDir } = make();
    await routes["POST /secrets/add-blank"]({ folder, names: ["SIGNING"], environment: "production" });
    await expect(set({ name: "SIGNING", environment: "production" })).rejects.toThrow(/Give a value for SIGNING/);
    expect(prompt).not.toHaveBeenCalled();

    prompt.mockResolvedValueOnce(false);
    expect(await set({ name: "SIGNING", value: VALUE, environment: "production" })).toEqual({ denied: true, label: "Owner/Repo" });
    expect((await vault.valuesFor(folder, ["SIGNING"], "production")).missing).toEqual(["SIGNING"]);

    onChange.mockClear();
    const ok = await set({ name: "SIGNING", value: VALUE, environment: "production" });
    expect(ok).toEqual({ ok: true, label: "Owner/Repo" });
    expect(JSON.stringify(ok)).not.toContain(VALUE);
    expect(prompt).toHaveBeenLastCalledWith("let a thread set SIGNING (Owner/Repo, production)");
    expect(prompt.mock.calls.flat().join("\n")).not.toContain(VALUE);
    expect(await vault.valuesFor(folder, ["SIGNING"], "production")).toMatchObject({ values: { SIGNING: VALUE }, missing: [] });
    expect((await vault.valuesFor(folder, ["SIGNING"], "development")).values).toEqual({});
    expect(onChange).toHaveBeenCalledWith(folder);
    // On disk: ciphertext only, in 0600 files.
    const dir = path.join(dataDir, "vault");
    for (const f of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toContain(VALUE);
      expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    }

    // Filled now, so a second set (an overwrite) is refused before any prompt.
    prompt.mockClear();
    expect(await set({ name: "SIGNING", value: "another", environment: "production" })).toEqual({ filled: true, label: "Owner/Repo" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("overwrites a filled value only with replace, after a Touch ID that says it overwrites", async () => {
    const { folder, vault, set, prompt } = make();
    await vault.setValue(folder, "PRICE", "production", "price_live");
    await vault.setValue(folder, "PRICE", "development", "price_dev");
    prompt.mockClear();
    // A string "true" isn't replace: only a real true is.
    expect(await set({ name: "PRICE", value: "price_sandbox", environment: "production", replace: "true" })).toEqual({ filled: true, label: "Owner/Repo" });
    expect(prompt).not.toHaveBeenCalled();

    prompt.mockResolvedValueOnce(false);
    expect(await set({ name: "PRICE", value: "price_sandbox", environment: "production", replace: true })).toEqual({ denied: true, label: "Owner/Repo" });
    expect((await vault.valuesFor(folder, ["PRICE"], "production")).values).toEqual({ PRICE: "price_live" });

    const ok = await set({ name: "PRICE", value: "price_sandbox", environment: "production", replace: true });
    expect(ok).toEqual({ ok: true, replaced: true, label: "Owner/Repo" });
    expect(prompt).toHaveBeenLastCalledWith("let a thread overwrite the production value of PRICE (Owner/Repo) with a new one");
    expect(prompt.mock.calls.flat().join("\n")).not.toMatch(/price_(live|sandbox)/);
    expect((await vault.valuesFor(folder, ["PRICE"], "production")).values).toEqual({ PRICE: "price_sandbox" });
    // Only that environment changes.
    expect((await vault.valuesFor(folder, ["PRICE"], "development")).values).toEqual({ PRICE: "price_dev" });
    // replace on a blank is a plain set; on a name that isn't there, add_blank still comes first.
  });

  it("adds a name that isn't in that environment yet, after a Touch ID that says it adds", async () => {
    const { folder, vault, set, prompt } = make();
    // No vault at all yet.
    expect(await set({ name: "NEW", value: VALUE, environment: "production" })).toEqual({ ok: true, added: true, label: "Owner/Repo" });
    expect(prompt).toHaveBeenLastCalledWith("let a thread add NEW (Owner/Repo, production)");
    expect((await vault.valuesFor(folder, ["NEW"], "production")).values).toEqual({ NEW: VALUE });
    // Another environment of the same name is its own add, and replace doesn't change that.
    expect(await set({ name: "NEW", value: "dev-value", replace: true })).toEqual({ ok: true, added: true, label: "Owner/Repo" });
    expect((await vault.valuesFor(folder, ["NEW"], "production")).values).toEqual({ NEW: VALUE });
    prompt.mockResolvedValueOnce(false);
    expect(await set({ name: "NOPE", value: VALUE })).toEqual({ denied: true, label: "Owner/Repo" });
    expect(((await vault.names(folder)) as { secrets: { name: string }[] }).secrets.map((s) => s.name)).not.toContain("NOPE");
    await expect(set({ name: "1BAD", value: VALUE })).rejects.toThrow(/isn't a variable name/);
  });

  it("puts an asked-for key in as a blank, but says so when it already has a value", async () => {
    const { routes, folder, vault } = make();
    const ask = (body: Record<string, unknown>) => routes["POST /secrets/ask-add"]({ folder, ...body });
    expect(await ask({ name: "NEW" })).toEqual({ added: true });
    expect((await vault.names(folder)).secrets).toContainEqual({ name: "NEW", environment: "development", missing: true });
    await vault.setValue(folder, "PRICE", "production", "price_live");
    expect(await ask({ name: "PRICE", environment: "production" })).toEqual({ filled: true, label: "Owner/Repo" });
    expect((await vault.valuesFor(folder, ["PRICE"], "production")).values).toEqual({ PRICE: "price_live" });
    // A value in another environment doesn't count: production has one, development gets the blank.
    expect(await ask({ name: "PRICE" })).toEqual({ added: true });
    // No vault, or a failing one, still answers so the thread hears where to add it by hand.
    expect(await vaultRoutes(() => undefined)["POST /secrets/ask-add"]({ folder, name: "K" })).toEqual({ added: true });
    const failing = { addBlanks: () => Promise.reject(new Error("locked")) };
    expect(await vaultRoutes(() => failing)["POST /secrets/ask-add"]({ folder, name: "K" })).toEqual({ added: true });
  });

  it("grants a thread standing access, naming the card and its reason", async () => {
    const { routes, folder, vault, prompt } = make();
    const result = (await routes["POST /secrets/request-access"]({ folder, thread: "Build card", why: "Need to run migrations" }, "/secrets/request-access")) as { granted?: boolean; label: string };
    expect(result).toMatchObject({ granted: true, label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls.flat().join("\n")).toContain("Build card");
    expect(vault.grantList()).toEqual([expect.objectContaining({ card: "c1", thread: "Build card", label: "Owner/Repo" })]);
  });

  // A grant that names writes lets the card store a value and push it to Vercel without asking
  // again; one that lasts for the thread says so, and ends with the card (2026-10-29).
  it("passes the writes and the span the thread asked for", async () => {
    const { routes, folder, vault } = make();
    await routes["POST /secrets/request-access"]({ folder, thread: "Build card", why: "w", writes: true, span: "thread" }, "/secrets/request-access");
    expect(vault.grantList()).toEqual([expect.objectContaining({ card: "c1", writes: true, span: "thread" })]);
  });

  it("asks for no writes and an hour's span when the thread doesn't name them", async () => {
    const { routes, folder, vault } = make();
    await routes["POST /secrets/request-access"]({ folder, thread: "Build card", why: "w" }, "/secrets/request-access");
    expect(vault.grantList()).toEqual([expect.objectContaining({ card: "c1", writes: false, span: "hour" })]);
  });

  it("asks for an hour's span when the thread names anything but the thread's", async () => {
    const { routes, folder, vault } = make();
    await routes["POST /secrets/request-access"]({ folder, thread: "Build card", why: "w", span: "forever" }, "/secrets/request-access");
    expect(vault.grantList()).toEqual([expect.objectContaining({ card: "c1", span: "hour" })]);
  });

  // A card's grants end with its work (lib/vault-grant-done.ts).
  it("ends the card's grants when its work is done", async () => {
    const { routes, folder, vault } = make();
    await routes["POST /secrets/request-access"]({ folder, thread: "Build card", why: "w", writes: true }, "/secrets/request-access");
    expect(vault.grantList()).toHaveLength(1);
    expect(await routes["POST /secrets/revoke-card"]({}, "/secrets/revoke-card")).toEqual({ revoked: 1 });
    expect(vault.grantList()).toEqual([]);
  });

  it("ends nothing when the request proves no card", async () => {
    const { vault, folder } = make();
    await vault.grant(folder, { card: "c1", thread: "Build card", by: "you" });
    const routes = vaultRoutes(() => vault, () => "");
    expect(await routes["POST /secrets/revoke-card"]({}, "/secrets/revoke-card")).toEqual({ revoked: 0 });
    expect(vault.grantList()).toHaveLength(1);
  });

  // The card is the signed one, never the body's key: a body that names another card's id must not
  // borrow that card's grant (2026-10-28).
  it("grants the card the request proved, not the card it names", async () => {
    const { vault, folder, prompt } = make();
    const routes = vaultRoutes(() => vault, (_body, route) => (route === "/secrets/request-access" ? "proven" : ""));
    await routes["POST /secrets/request-access"]({ key: "someone-else", folder, thread: "Build card", why: "w" }, "/secrets/request-access");
    expect(vault.grantList()).toEqual([expect.objectContaining({ card: "proven" })]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("serves the audit outbox and marks it synced", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-audit-"));
    configureAudit({ dataDir });
    try {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
      const audited = createVault({
        dataDir,
        safeStorage,
        sodium,
        prompt: () => Promise.resolve(true),
        clipboard: { writeText: vi.fn(), readText: () => "" },
        run: () => Promise.resolve("git@github.com:Owner/Repo.git"),
        audit,
      });
      const routes = vaultRoutes(() => audited);
      await audited.setValue(folder, "A", "development", "value");

      const outbox = (await routes["POST /secrets/audit-outbox"]({})) as { entries: { id: string; action: string }[] };
      expect(outbox.entries.length).toBeGreaterThan(0);
      expect(outbox.entries.map((e) => e.action)).toContain("set");
      const id = outbox.entries[outbox.entries.length - 1]!.id;
      expect(await routes["POST /secrets/audit-synced"]({ id })).toEqual({ ok: true });
      const after = (await routes["POST /secrets/audit-outbox"]({})) as { entries: { id: string }[] };
      expect(after.entries.some((e) => e.id === id)).toBe(false);
    } finally {
      resetAudit();
    }
  });

  it("asks Touch ID for each set even while the drawer and a thread's fill are unlocked", async () => {
    const { routes, folder, vault, set, prompt } = make();
    await routes["POST /secrets/add-blank"]({ folder, names: ["A", "B"] });
    await vault.setValue(folder, "C", "development", "c");
    await vault.reveal("github:owner/repo", "C", "development");
    await vault.useFor(folder, "C", "development", { card: "c1", site: "a.test" });
    prompt.mockClear();
    await set({ name: "A", value: "a-value" });
    await set({ name: "B", value: "b-value" });
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  // A card whose grant names writes stores a value it made without asking again: the user
  // approved its writes up front (electron/vault-grants.cjs, 2026-10-29).
  describe("a grant that names writes", () => {
    it("adds a name without asking again", async () => {
      const { folder, vault, set, prompt } = make();
      await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", writes: true });
      prompt.mockClear();

      expect(await set({ name: "NEW", value: VALUE })).toEqual({ ok: true, added: true, label: "Owner/Repo" });
      expect(prompt).not.toHaveBeenCalled();
      expect((await vault.valuesFor(folder, ["NEW"], "development")).values).toEqual({ NEW: VALUE });
    });

    it("fills a blank without asking again", async () => {
      const { routes, folder, vault, set, prompt } = make();
      await routes["POST /secrets/add-blank"]({ folder, names: ["SIGNING"], environment: "production" });
      await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", writes: true });
      prompt.mockClear();

      expect(await set({ name: "SIGNING", value: VALUE, environment: "production" })).toEqual({ ok: true, label: "Owner/Repo" });
      expect(prompt).not.toHaveBeenCalled();
      expect((await vault.valuesFor(folder, ["SIGNING"], "production")).values).toEqual({ SIGNING: VALUE });
    });

    // An overwrite destroys the value that was there, so it asks even under a grant that names writes.
    it("still asks before an overwrite", async () => {
      const { folder, vault, set, prompt } = make();
      await vault.setValue(folder, "PRICE", "production", "price_live");
      await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", writes: true });
      prompt.mockClear();

      expect(await set({ name: "PRICE", value: "price_sandbox", environment: "production", replace: true })).toEqual({ ok: true, replaced: true, label: "Owner/Repo" });
      expect(prompt).toHaveBeenCalledWith("let a thread overwrite the production value of PRICE (Owner/Repo) with a new one");
    });

    // The grant is the card's own, not the one the body names (electron/card-token.cjs).
    it("uses the card the request proved, not the card it names", async () => {
      const { vault, folder, prompt } = make();
      await vault.grant(folder, { card: "proven", thread: "Build card", by: "you", writes: true });
      const routes = vaultRoutes(() => vault, (_body, route) => (route === "/secrets/set" ? "proven" : ""));
      prompt.mockClear();

      expect(await routes["POST /secrets/set"]({ folder, name: "NEW", value: VALUE, card: "someone-else" }, "/secrets/set")).toEqual({ ok: true, added: true, label: "Owner/Repo" });
      expect(prompt).not.toHaveBeenCalled();
    });

    it("asks when the card's grant names no writes", async () => {
      const { folder, vault, set, prompt } = make();
      await vault.grant(folder, { card: "c1", thread: "Build card", by: "you" });
      prompt.mockClear();

      expect(await set({ name: "NEW", value: VALUE })).toEqual({ ok: true, added: true, label: "Owner/Repo" });
      expect(prompt).toHaveBeenCalledWith("let a thread add NEW (Owner/Repo, development)");
    });
  });
});
