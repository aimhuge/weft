// What main keeps about worker vault asks across restarts (electron/worker-vault-guards.cjs): answered nonces, sealed,
// and each card's project, only for a card its owner started.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAskNonces, createCardOrigins, writeWhole } from "./worker-vault-guards.cjs";

const plainStore = () => ({ encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, "") });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-vault-guards-"));
const NOW = 1_000_000;

describe("createAskNonces", () => {
  it("answers a nonce once, across a restart, and forgets it after its ask expires", () => {
    const dir = tmp();
    let now = NOW;
    const a = createAskNonces({ dir, safeStorage: plainStore, now: () => now });
    a.take("n1", NOW + 60_000);
    expect(() => a.take("n1", NOW + 60_000)).toThrow("already answered");
    const file = path.join(dir, "vault", "worker-ask-nonces.json");
    expect(Buffer.from(fs.readFileSync(file, "utf8"), "base64").toString()).toMatch(/^sealed:/);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const b = createAskNonces({ dir, safeStorage: plainStore, now: () => now });
    expect(() => b.take("n1", NOW + 60_000)).toThrow("already answered");
    now = NOW + 60_001;
    b.take("n1", now + 60_000);
  });

  it("fails closed on a file that won't open: nothing that could have been signed before is answered", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "vault"));
    fs.writeFileSync(path.join(dir, "vault", "worker-ask-nonces.json"), "garbage");
    const a = createAskNonces({ dir, safeStorage: () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: () => "[1]" }), now: () => NOW });
    expect(() => a.take("n2", NOW + 60_000)).toThrow("already answered");
    a.take("n3", NOW + 11 * 60_000);
  });

  it("keeps them in memory when it has no folder", () => {
    const a = createAskNonces();
    a.take("n", Date.now() + 1_000);
    expect(() => a.take("n", Date.now() + 1_000)).toThrow("already answered");
  });
});

function db(rows: unknown[] | null, error: { message: string } | null = null) {
  const calls: unknown[][] = [];
  const q = {
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
    in: (...a: unknown[]) => (calls.push(["in", ...a]), Promise.resolve({ data: rows, error })),
  };
  return { supabase: { from: (t: string) => (calls.push(["from", t]), { select: () => q }) }, calls };
}

describe("createCardOrigins", () => {
  it("pins a card its owner started, by the folder it was started in, and refuses it if that changes", async () => {
    const dataDir = tmp();
    const check = createCardOrigins({ dataDir });
    const d = db([{ kind: "new_card", folder: "weft", created_by: "u1", payload: {} }]);
    await check(d.supabase, "u1", "w1", "c1", "weft");
    expect(d.calls).toContainEqual(["eq", "created_by", "u1"]);
    expect(d.calls).toContainEqual(["eq", "target_device", "worker:w1"]);
    // Pinned: no read the second time, and another folder is refused.
    const again = db(null, { message: "unused" });
    await check(again.supabase, "u1", "w1", "c1", "weft");
    await expect(check(again.supabase, "u1", "w1", "c1", "secrets")).rejects.toThrow("was in weft when it first reached the vault");
    expect(fs.statSync(path.join(dataDir, "vault", "worker-card-folders.json")).mode & 0o777).toBe(0o600);
  });

  it("refuses a card nobody it knows started, one started in another folder, and a read that failed", async () => {
    const check = createCardOrigins({ dataDir: tmp() });
    await expect(check(db([]).supabase, "u1", "w1", "c1", "weft")).rejects.toThrow("card you started");
    await expect(check(db([{ kind: "new_card", folder: "weft", created_by: "u2" }]).supabase, "u1", "w1", "c1", "weft")).rejects.toThrow("card you started");
    await expect(check(db([{ kind: "host", folder: "weft", created_by: "u1", payload: { verb: "card.rename" } }]).supabase, "u1", "w1", "c1", "weft")).rejects.toThrow("card you started");
    await expect(check(db([{ kind: "run", folder: "other", created_by: "u1" }]).supabase, "u1", "w1", "c1", "weft")).rejects.toThrow("was started in other");
    await expect(check(db(null, { message: "offline" }).supabase, "u1", "w1", "c1", "weft")).rejects.toThrow("Couldn't check where that card came from: offline");
    await check(db([{ kind: "host", folder: "weft", created_by: "u1", payload: { verb: "card.create" } }]).supabase, "u1", "w1", "c2", "weft");
  });

  it("writes one pin at a time, so two cards checked at once both stay pinned", async () => {
    const dataDir = tmp();
    const check = createCardOrigins({ dataDir });
    const d = db([{ kind: "run", folder: "weft", created_by: "u1" }]);
    await Promise.all([check(d.supabase, "u1", "w1", "a", "weft"), check(d.supabase, "u1", "w1", "b", "weft"), check(d.supabase, "u1", "w1", "z", "nope").catch(() => null)]);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir, "vault", "worker-card-folders.json"), "utf8")) as object).sort()).toEqual(["w1\na", "w1\nb"]);
    const spy = vi.spyOn(fs, "renameSync");
    writeWhole(path.join(dataDir, "x.json"), "{}");
    expect(spy).toHaveBeenCalled();
    expect(fs.readdirSync(dataDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    spy.mockRestore();
  });
});
