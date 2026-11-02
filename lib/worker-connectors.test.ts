import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as cjsWire from "../electron/connector-wire.cjs";
import * as cjsSeal from "../electron/worker-seal.cjs";
import { CONNECTORS, connectorMessage, connectorPurpose, connectorStorePurpose, isConnector } from "./connector-wire";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { connectorBin, createConnectors, findReal, MAX_TTL_MS } from "./worker-connectors";
import { newSealKeys, open, type Sealed } from "./worker-seal";

const keys = newSealKeys();
const mac = macSigner();
const NOW = 1_700_000_000_000;
let n = 0;

function box(over: { macs?: string[]; which?: (bin: string) => string | null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-connectors-"));
  const c = createConnectors({ home, keys, macs: memoryMacs(over.macs ?? [mac.key]), which: over.which ?? ((b) => `/usr/bin/${b}`), node: "/opt/node's/bin/node", runner: "/weft/electron/connector-exec.cjs", now: () => NOW });
  return { home, c };
}

// What the Mac sends: the token sealed to this box for the connector and nonce, signed over all of it.
function command(op: "token" | "forget", connector = "gog", over: Record<string, unknown> = {}, issuedAt = NOW + ++n) {
  const nonce = String(n).padStart(64, "0");
  const sealed: Sealed | null = op === "token" ? cjsSeal.seal(keys.publicKey, JSON.stringify({ v: 1, connector, account: "me@example.com", token: "ya29.access-token", expiresAt: NOW + 3_600_000, issuedAt, ...over }), connectorPurpose(connector, nonce)) : null;
  return { op, connector, nonce, issuedAt, ...(sealed ? { sealed } : {}), mac: { key: mac.key, sig: mac.sign(connectorMessage(op, connector, nonce, issuedAt, sealed)) } };
}

describe("the connector wire", () => {
  it("agrees on both sides", () => {
    expect(cjsWire.CONNECTORS).toEqual(CONNECTORS);
    expect(cjsWire.connectorPurpose("gh", "n")).toBe(connectorPurpose("gh", "n"));
    const sealed = { v: 1 as const, epk: "e", iv: "i", ct: "c", tag: "t" };
    expect(cjsWire.connectorMessage("token", "gh", "n", 5, sealed)).toBe(connectorMessage("token", "gh", "n", 5, sealed));
    expect(cjsWire.connectorMessage("forget", "gh", "n", 5, null)).toBe(connectorMessage("forget", "gh", "n", 5));
    expect([isConnector("gog"), isConnector("gh"), isConnector("toString"), isConnector(3)]).toEqual([true, true, false, false]);
    expect([cjsWire.isConnector("gh"), cjsWire.isConnector("hasOwnProperty")]).toEqual([true, false]);
  });
});

describe("createConnectors", () => {
  it("keeps a token sealed at rest and writes a shim that runs the real CLI", () => {
    const { home, c } = box();
    expect(c.deliver(command("token"))).toBeNull();
    const stored = JSON.parse(fs.readFileSync(path.join(home, "connectors.json"), "utf8")) as Record<string, { sealed: Sealed; bin: string; account: string }>;
    expect(JSON.stringify(stored)).not.toContain("ya29");
    expect(stored.gog).toMatchObject({ bin: "/usr/bin/gog", account: "me@example.com" });
    expect(JSON.parse(open(keys, stored.gog!.sealed, connectorStorePurpose("gog")))).toMatchObject({ token: "ya29.access-token" });
    const shim = fs.readFileSync(path.join(connectorBin(home), "gog"), "utf8");
    expect(shim).toBe(`#!/bin/sh\nexec '/opt/node'\\''s/bin/node' '/weft/electron/connector-exec.cjs' '${home}' gog "$@"\n`);
    expect(fs.statSync(path.join(connectorBin(home), "gog")).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(home, "connectors.json")).mode & 0o777).toBe(0o600);
    expect(c.status()[0]).toMatch(/^Google Workspace \(gog\): me@example.com, until /);
    expect(c.status()[1]).toBe("GitHub (gh): off");
  });

  it("forgets on the Mac's word, and refuses anything older than what it has", () => {
    const { home, c } = box();
    const first = command("token", "gh");
    c.deliver(command("forget", "gh"));
    expect(() => c.deliver(first)).toThrow("older than the one this worker has");
    c.deliver(command("token", "gh"));
    expect(fs.existsSync(path.join(connectorBin(home), "gh"))).toBe(true);
    const forget = command("forget", "gh");
    c.deliver(forget);
    expect(fs.existsSync(path.join(connectorBin(home), "gh"))).toBe(false);
    expect(() => c.deliver(forget)).toThrow("older");
    expect(c.status()[1]).toBe("GitHub (gh): off");
  });

  it("takes commands only from the Mac it was paired with", () => {
    expect(() => box({ macs: [] }).c.deliver(command("token"))).toThrow("enrolled by token");
    const other = macSigner();
    expect(() => box({ macs: [other.key] }).c.deliver(command("token"))).toThrow("a Mac this worker wasn't paired with");
    const forged = { ...command("token"), issuedAt: NOW + 999_999 };
    expect(() => box().c.deliver(forged)).toThrow("signature doesn't check out");
  });

  it("refuses what Weft doesn't send", () => {
    const { c } = box();
    for (const bad of [null, { ...command("token"), op: "steal" }, { ...command("token"), connector: "slack" }, { ...command("token"), nonce: "x" }, { ...command("token"), issuedAt: 1.5 }, { ...command("token"), mac: null }, { ...command("token"), sealed: undefined }])
      expect(() => c.deliver(bad)).toThrow("isn't one Weft makes");
    const wrongKey = command("token");
    wrongKey.sealed = cjsSeal.seal(newSealKeys().publicKey, "{}", connectorPurpose("gog", wrongKey.nonce));
    wrongKey.mac.sig = mac.sign(connectorMessage("token", "gog", wrongKey.nonce, wrongKey.issuedAt, wrongKey.sealed));
    expect(() => c.deliver(wrongKey)).toThrow("wasn't sealed to this worker");
  });

  it.each([
    [{ connector: "gh" }, "isn't one Weft makes"],
    [{ token: "short" }, "isn't one Weft makes"],
    [{ token: "has space inside" }, "isn't one Weft makes"],
    [{ v: 2 }, "isn't one Weft makes"],
    [{ account: "x".repeat(321) }, "isn't one Weft makes"],
    [{ expiresAt: NOW }, "expiry"],
    [{ expiresAt: NOW + MAX_TTL_MS + 1 }, "expiry"],
    [{ expiresAt: "soon" }, "expiry"],
  ])("refuses a token with %o", (over, why) => {
    expect(() => box().c.deliver(command("token", "gog", over))).toThrow(why);
  });

  it("refuses a sealed payload that isn't JSON", () => {
    const cmd = command("token");
    cmd.sealed = cjsSeal.seal(keys.publicKey, "not json", connectorPurpose("gog", cmd.nonce));
    cmd.mac.sig = mac.sign(connectorMessage("token", "gog", cmd.nonce, cmd.issuedAt, cmd.sealed));
    expect(() => box().c.deliver(cmd)).toThrow("isn't one Weft makes");
  });

  it("stores the token but writes no shim where the CLI isn't installed, and says so", () => {
    const { home, c } = box({ which: () => null });
    c.deliver(command("token", "gh"));
    expect(fs.existsSync(path.join(connectorBin(home), "gh"))).toBe(false);
    expect(c.status()[1]).toContain("(gh isn't installed here)");
  });

  it("says when a token has expired, and reads a damaged store as empty", () => {
    let now = NOW;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-connectors-"));
    const c = createConnectors({ home, keys, macs: memoryMacs([mac.key]), which: () => "/usr/bin/gh", node: "n", runner: "r", now: () => now });
    c.deliver(command("token", "gh", { account: "" }));
    now += 4_000_000;
    expect(c.status()[1]).toBe("GitHub (gh): ?, expired: your Mac sends a fresh one while it's on");
    fs.writeFileSync(path.join(home, "connectors.json"), "{");
    expect(c.status()[1]).toBe("GitHub (gh): off");
    fs.writeFileSync(path.join(home, "connectors.json"), JSON.stringify({ gh: { issuedAt: 1, sealed: { v: 1 }, bin: "/usr/bin/gh" } }));
    expect(c.status()[1]).toBe("GitHub (gh): ?, expired: your Mac sends a fresh one while it's on");
  });
});

describe("findReal", () => {
  it("finds the CLI on PATH past the shims' folder", () => {
    const shims = fs.mkdtempSync(path.join(os.tmpdir(), "weft-shims-"));
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "weft-real-"));
    fs.writeFileSync(path.join(shims, "gh"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(real, "gh"), "#!/bin/sh\n", { mode: 0o755 });
    fs.mkdirSync(path.join(real, "gog"));
    expect(findReal("gh", ["", shims, real].join(path.delimiter), shims)).toBe(path.join(real, "gh"));
    expect(findReal("gog", [shims, real].join(path.delimiter), shims)).toBeNull();
  });
});
