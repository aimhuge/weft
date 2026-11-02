// Main's book of spent widening nonces (electron/widen-nonces.cjs): a nonce runs once, the copy on disk is sealed and
// carries it across a restart, and a copy that's gone or garbled fails closed rather than forgetting what was spent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWidenNonces, KEEP_MS } from "./widen-nonces.cjs";

// A stand-in for safeStorage: reversible, and not plain JSON on disk.
const safeStorage = () => ({
  encryptString: (s: string) => Buffer.from(`sealed:${s}`),
  decryptString: (b: Buffer) => {
    const text = b.toString();
    if (!text.startsWith("sealed:")) throw new Error("not ours");
    return text.slice("sealed:".length);
  },
});

let dir: string;
let clock: number;
const book = () => createWidenNonces({ dir, safeStorage, now: () => clock });
const N = "nonce-000000000001";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "widen-nonces-"));
  clock = 1_000_000;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("main's widening nonces", () => {
  it("spends a nonce once, sealed in the vault folder, and remembers it across a restart", () => {
    const first = book();
    // The first ever read finds no file, so only what was signed from now on runs.
    expect(first.take({ nonce: N, issuedAt: clock - 1 })).toBe(false);
    expect(first.take({ nonce: N, issuedAt: clock })).toBe(true);
    expect(first.take({ nonce: N, issuedAt: clock })).toBe(false);
    expect(first.file).toBe(path.join(dir, "vault", "widen-nonces.json"));
    expect(fs.readFileSync(first.file, "utf8")).not.toContain(N);
    clock += 1000;
    const again = book();
    expect(again.take({ nonce: N, issuedAt: clock - 1000 })).toBe(false);
    expect(again.take({ nonce: "nonce-000000000002", issuedAt: clock - 1000 })).toBe(true);
  });

  it("fails closed when the copy on disk is deleted or rewritten: nothing signed before it was read runs", () => {
    const first = book();
    first.take({ nonce: N, issuedAt: clock });
    const issuedAt = clock;
    clock += 30_000;
    fs.writeFileSync(first.file, JSON.stringify({}));
    expect(book().take({ nonce: N, issuedAt })).toBe(false);
    fs.rmSync(first.file);
    expect(book().take({ nonce: N, issuedAt })).toBe(false);
    expect(book().take({ nonce: "nonce-000000000003", issuedAt: clock })).toBe(true);
  });

  it("forgets a nonce once its approval is too old anyway, and refuses one that isn't a nonce", () => {
    const b = book();
    expect(b.take({ nonce: N, issuedAt: clock })).toBe(true);
    clock += KEEP_MS + 1;
    expect(b.take({ nonce: "nonce-000000000004", issuedAt: clock })).toBe(true);
    expect(JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(b.file, "utf8"), "base64")))).not.toHaveProperty(N);
    expect(b.take({ nonce: "short", issuedAt: clock })).toBe(false);
    expect(b.take({ nonce: "nonce-000000000005", issuedAt: Number.NaN })).toBe(false);
    expect(b.take({ nonce: undefined, issuedAt: clock })).toBe(false);
  });
});
