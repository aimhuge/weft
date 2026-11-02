import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileNonceStore, nonceBook, sharedNonceBook, type NonceStore } from "./widen-nonces";

const memory = (start: Record<string, number> = {}) => {
  const saved: Record<string, number>[] = [];
  const store: NonceStore = { load: () => ({ ...start }), save: (n) => void saved.push({ ...n }) };
  return { store, saved };
};

describe("nonceBook", () => {
  it("takes a nonce once, keeps it until its time, and forgets it after", () => {
    let now = 100;
    const { store, saved } = memory({ old: 50, kept: 500 });
    const book = nonceBook(store, () => now);
    expect(book.has("kept")).toBe(true);
    expect(book.has("old")).toBe(false);
    expect(book.take("n1", 200)).toBe(true);
    expect(book.take("n1", 200)).toBe(false);
    expect(saved.at(-1)).toEqual({ kept: 500, n1: 200 });
    now = 300;
    expect(book.has("n1")).toBe(false);
    expect(book.take("n1", 400)).toBe(true);
  });

  it("uses the clock by default", () => {
    const book = nonceBook(memory().store);
    expect(book.take("x", Date.now() + 1000)).toBe(true);
    expect(book.has("x")).toBe(true);
  });
});

describe("fileNonceStore", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it("keeps the nonces across a restart, mode 600, and starts empty from a missing or broken file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nonces-"));
    dirs.push(dir);
    const file = path.join(dir, "sub", "n.json");
    const store = fileNonceStore(file);
    expect(store.load()).toEqual({});
    store.save({ a: 1 });
    expect(fileNonceStore(file).load()).toEqual({ a: 1 });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.writeFileSync(file, JSON.stringify({ a: 1, b: "x" }));
    expect(store.load()).toEqual({ a: 1 });
    fs.writeFileSync(file, "[1]");
    expect(store.load()).toEqual({});
    fs.writeFileSync(file, "null");
    expect(store.load()).toEqual({});
    fs.writeFileSync(file, "{");
    expect(store.load()).toEqual({});
  });
});

describe("sharedNonceBook", () => {
  it("gives one book per file in a process, so a nonce one caller spent the other sees", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-shared-nonces-")), "n.json");
    const a = sharedNonceBook(file);
    expect(sharedNonceBook(`${path.dirname(file)}/./n.json`)).toBe(a);
    expect(a.take("nonce-000000000001", Date.now() + 60_000)).toBe(true);
    expect(sharedNonceBook(file).take("nonce-000000000001", Date.now() + 60_000)).toBe(false);
  });
});
