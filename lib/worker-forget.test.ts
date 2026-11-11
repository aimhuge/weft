import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FORGOTTEN, forgetBox, forgetDone, forgetRefusal } from "./worker-forget";
import { enrolRefusal, macKeysAt, trustPairingMac } from "./worker-mac-keys";

let home: string;
const put = (name: string, text = "x") => {
  fs.mkdirSync(path.dirname(path.join(home, name)), { recursive: true });
  fs.writeFileSync(path.join(home, name), text);
};
const has = (name: string) => fs.existsSync(path.join(home, name));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "forget-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("forgetBox", () => {
  it("drops the enrolment and every trust file, and keeps what makes it the same box", () => {
    for (const f of [...FORGOTTEN, "sign-key.json", "seal-key.json", "worker.env", "work/repo/a.txt", "data/board.json"]) put(f);
    expect(forgetBox(home).sort()).toEqual([...FORGOTTEN].sort());
    for (const f of FORGOTTEN) expect(has(f)).toBe(false);
    for (const f of ["sign-key.json", "seal-key.json", "worker.env", "work/repo/a.txt", "data/board.json"]) expect(has(f)).toBe(true);
  });

  it("says nothing was there on a box that wasn't paired", () => {
    expect(forgetBox(home)).toEqual([]);
    expect(forgetDone([])).toMatch(/^Nothing to forget/);
  });

  // m1mini, 2026-11-06: the box put its one Mac key on mac-revoked.json, and a new code from that Mac carries the same
  // key, so re-enrolling couldn't fix it. After a forget, the same key is trusted again.
  it("lets the same Mac's key be trusted again after it was marked revoked", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const code = `wph.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.${Buffer.alloc(32, 3).toString("base64url")}.${Buffer.from(key, "base64").toString("base64url")}`;
    const macs = macKeysAt(home);
    macs.pin(key);
    macs.revoke([key]);
    expect(macs.pinned()).toEqual([]);
    forgetBox(home);
    expect(enrolRefusal(fs.existsSync(path.join(home, "mac-keys.json")), false, false)).toBeNull();
    expect(trustPairingMac(home, code)).toBe(true);
    expect(macKeysAt(home).pinned()).toEqual([key]);
  });
});

describe("forgetRefusal", () => {
  it("runs only from a terminal, with the box's name typed back", () => {
    expect(forgetRefusal(false, "m1mini", "m1mini")).toMatch(/only runs from a terminal/);
    expect(forgetRefusal(true, "m1mini", "yes")).toBe("Not forgotten: type m1mini to confirm.");
    expect(forgetRefusal(true, "m1mini", " m1mini\n")).toBeNull();
  });
});

describe("forgetDone", () => {
  it("names what went and the next steps", () => {
    const text = forgetDone(["worker.json", "mac-keys.json"]);
    expect(text).toContain("Forgot worker.json, mac-keys.json.");
    expect(text).toContain("weft-worker enrol wph.…");
    expect(text).toContain("weft-worker restart");
  });
});
