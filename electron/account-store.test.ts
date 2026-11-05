import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountRoutes, accountRoutesFor, createAccountStore } from "./account-store.cjs";

const safeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decryptString: (buf: Buffer) => Buffer.from(buf.toString().slice("sealed:".length), "base64").toString(),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-acct-"));
const SESSION = { "weft-auth": '{"refresh_token":"rt-test"}' };

describe("createAccountStore", () => {
  it("keeps the session sealed, readable only by you, and never in plain text", () => {
    const dir = tmp();
    const store = createAccountStore({ dataDir: path.join(dir, "data"), safeStorage: safeStorage() });
    expect(store.sealed()).toBe(true);
    expect(store.read()).toEqual({});
    store.write(SESSION);
    const sealed = path.join(dir, "data", "account.sealed");
    expect(fs.readFileSync(sealed, "utf8")).not.toContain("rt-test");
    expect(fs.statSync(sealed).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, "data", "account.json"))).toBe(false);
    expect(store.read()).toEqual(SESSION);
  });

  it("moves an old plain account.json in and deletes it", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "account.json"), JSON.stringify(SESSION));
    const store = createAccountStore({ dataDir: dir, safeStorage: safeStorage() });
    expect(store.read()).toEqual(SESSION);
    expect(fs.existsSync(path.join(dir, "account.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "account.sealed"))).toBe(true);
  });

  it("stays the plain file without the Keychain, and reads a broken one as signed out", () => {
    const dir = tmp();
    const store = createAccountStore({ dataDir: dir, safeStorage: safeStorage(false) });
    expect(store.sealed()).toBe(false);
    store.write(SESSION);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "account.json"), "utf8"))).toEqual(SESSION);
    expect(store.read()).toEqual(SESSION);
    fs.writeFileSync(path.join(dir, "account.json"), "{not json");
    expect(store.read()).toEqual({});
  });
});

describe("accountRoutes", () => {
  it("reads, and writes only string values", () => {
    const store = createAccountStore({ dataDir: tmp(), safeStorage: safeStorage() });
    const routes = accountRoutes(() => store);
    expect(routes["POST /account/read"]()).toEqual({ data: {} });
    expect(routes["POST /account/write"]({ data: { ...SESSION, junk: 3 } })).toEqual({ ok: true });
    expect(routes["POST /account/read"]()).toEqual({ data: SESSION });
    routes["POST /account/write"]({ data: "nope" });
    expect(store.read()).toEqual({});
  });

  it("makes its store on the first request", () => {
    const dir = tmp();
    let made = 0;
    const routes = accountRoutesFor(dir, () => {
      made++;
      return safeStorage();
    });
    expect(made).toBe(0);
    routes["POST /account/write"]({ data: SESSION });
    routes["POST /account/read"]();
    expect(made).toBe(1);
    expect(fs.existsSync(path.join(dir, "account.sealed"))).toBe(true);
  });
});
