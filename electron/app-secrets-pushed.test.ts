// Share… sending a link's keys on its own (electron/app-secrets-pushed.cjs and push's ifChanged): the ledger keeps a
// salted fingerprint per app, never a value; an unchanged or declined set answers with no Touch ID; a change asks once;
// overlapping calls share one sheet; the button and the control server's route pick the right mode.
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appSecretsRoutes, createAppSecretsPush } from "./app-secrets-push.cjs";
import { createPushedLedger, LEDGER_FILE } from "./app-secrets-pushed.cjs";

function makeDataDir(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-pushed-"));
  const folder = path.join(dataDir, "apps", "growth");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "index.html"), "<!doctype html>");
  const manifest = { name: "Growth", env: "production", secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] } } };
  fs.writeFileSync(path.join(folder, "weft-app.json"), JSON.stringify(manifest));
  const url = `file://${path.join(folder, "index.html")}`;
  fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({ apps: [{ id: "app-1", name: "Growth", url, share: { id: "share-1" }, addedAt: 1 }] }));
  return dataDir;
}

function setup({ confirm = true }: { confirm?: boolean } = {}) {
  const dataDir = makeDataDir();
  const values: Record<string, string> = { STRIPE_KEY: "sk_1" };
  const vault = { valuesFor: () => Promise.resolve({ label: "you/repo", values: { ...values }, missing: [] }) };
  const ask = vi.fn(() => Promise.resolve(confirm));
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("{}") });
  const handle = createAppSecretsPush({ dataDir, vault, account: () => ({ "weft-auth": { access_token: "tok" } }), confirm: ask, fetch: fetchImpl });
  return { dataDir, values, ask, fetchImpl, handle };
}

describe("createPushedLedger", () => {
  it("fingerprints by link and values, whatever the names' order, and never stores a value", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-ledger-"));
    const ledger = createPushedLedger(dataDir);
    const d = ledger.digest("s1", { A: "1", B: "2" });
    expect(ledger.digest("s1", { B: "2", A: "1" })).toBe(d);
    expect(ledger.digest("s2", { A: "1", B: "2" })).not.toBe(d);
    expect(ledger.digest("s1", { A: "1", B: "3" })).not.toBe(d);
    expect(ledger.settled("app-1", d)).toBe(false);
    ledger.sent("app-1", d);
    expect(ledger.settled("app-1", d)).toBe(true);
    const file = fs.readFileSync(path.join(dataDir, LEDGER_FILE), "utf8");
    expect(file).not.toContain('"1"');
    // A new run reads the same salt and entries back.
    const again = createPushedLedger(dataDir);
    expect(again.digest("s1", { A: "1", B: "2" })).toBe(d);
    expect(again.settled("app-1", d)).toBe(true);
  });

  it("remembers a decline for this run only, until the values go up", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-ledger-"));
    const ledger = createPushedLedger(dataDir);
    ledger.declined("app-1", "d1");
    expect(ledger.settled("app-1", "d1")).toBe(true);
    expect(ledger.settled("app-1", "d2")).toBe(false);
    expect(createPushedLedger(dataDir).settled("app-1", "d1")).toBe(false);
  });

  it("starts over from a file it can't read", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-ledger-"));
    fs.writeFileSync(path.join(dataDir, LEDGER_FILE), "not json");
    const ledger = createPushedLedger(dataDir);
    expect(ledger.settled("app-1", ledger.digest("s1", { A: "1" }))).toBe(false);
  });
});

describe("push with ifChanged", () => {
  it("sends keys that never went up, then answers unchanged with no Touch ID until a value changes", async () => {
    const { values, ask, fetchImpl, handle } = setup();
    expect(await handle.push("app-1", { ifChanged: true })).toEqual({ ok: true, pushed: ["STRIPE_KEY"], missing: [] });
    expect(await handle.push("app-1", { ifChanged: true })).toEqual({ ok: true, pushed: [], missing: [], unchanged: true });
    expect(ask).toHaveBeenCalledTimes(1);
    values.STRIPE_KEY = "sk_2";
    expect(await handle.push("app-1", { ifChanged: true })).toMatchObject({ pushed: ["STRIPE_KEY"] });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("counts the button's push as sent, and the button always asks", async () => {
    const { ask, handle } = setup();
    await handle.push("app-1");
    expect(await handle.push("app-1", { ifChanged: true })).toMatchObject({ unchanged: true });
    await handle.push("app-1");
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("doesn't ask again for values you declined, but the button does", async () => {
    const { ask, fetchImpl, handle } = setup({ confirm: false });
    expect(await handle.push("app-1", { ifChanged: true })).toEqual({ error: "Touch ID declined." });
    expect(await handle.push("app-1", { ifChanged: true })).toMatchObject({ unchanged: true });
    expect(await handle.push("app-1")).toEqual({ error: "Touch ID declined." });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shares one Touch ID between overlapping calls for the same app", async () => {
    const { ask, handle } = setup();
    const [a, b] = await Promise.all([handle.push("app-1", { ifChanged: true }), handle.push("app-1", { ifChanged: true })]);
    expect(a).toBe(b);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("appSecretsRoutes", () => {
  it("passes ifChanged through only when it's true, and refuses before main is ready", async () => {
    const push = vi.fn(() => Promise.resolve({ ok: true }));
    const route = appSecretsRoutes(() => ({ push }))["POST /apps/push-secrets"];
    await route({ appId: "app-1", ifChanged: true });
    await route({ appId: "app-1", ifChanged: "yes" });
    await route({});
    expect(push.mock.calls).toEqual([["app-1", { ifChanged: true }], ["app-1", { ifChanged: false }], ["", { ifChanged: false }]]);
    expect(() => appSecretsRoutes(() => null)["POST /apps/push-secrets"]({ appId: "x" })).toThrow("isn't ready yet");
  });
});
