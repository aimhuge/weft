import { describe, expect, it } from "vitest";
import { CHUNK, frame, readSyncMessage, safePath, unframer, type SyncMessage } from "./tree-sync-protocol";

const SHA = "a".repeat(40);
const HEAD = "f".repeat(40);

describe("tree sync protocol", () => {
  it("keeps paths inside the folder and out of .git", () => {
    for (const ok of ["a.ts", "src/b/c.tsx", ".env.example", "a..b"]) expect(safePath(ok)).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "./a", ".git/config", "a\\b", "C:x", "a\0b", 1, "x".repeat(1025)]) {
      expect(safePath(bad)).toBe(false);
    }
  });

  it("reads each message whole, or not at all", () => {
    const hello = { t: "hello", branch: "main", head: HEAD, prio: 1, files: { "a.ts": SHA, "b.ts": null } };
    expect(readSyncMessage(JSON.stringify(hello))).toEqual(hello);
    expect(readSyncMessage(JSON.stringify({ ...hello, files: { "../a": SHA } }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ ...hello, files: { a: "nope" } }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ ...hello, head: "x" }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ ...hello, prio: -1 }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ ...hello, branch: "" }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ ...hello, files: [] }))).toBeNull();

    const put = { t: "change", path: "a.ts", state: SHA, base: "HEAD", data: "aGk=", conflict: true };
    expect(readSyncMessage(JSON.stringify(put))).toEqual(put);
    expect(readSyncMessage(JSON.stringify({ ...put, conflict: "yes" }))).toEqual({ t: "change", path: "a.ts", state: SHA, base: "HEAD", data: "aGk=" });
    // Bytes go with a sha, and only with one.
    expect(readSyncMessage(JSON.stringify({ ...put, data: undefined }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ t: "change", path: "a.ts", state: null, base: SHA, data: "aGk=" }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ t: "change", path: "a.ts", state: "HEAD", base: null }))).toEqual({ t: "change", path: "a.ts", state: "HEAD", base: null });
    expect(readSyncMessage(JSON.stringify({ t: "change", path: "a.ts", state: SHA, base: "bad", data: "" }))).toBeNull();

    expect(readSyncMessage(JSON.stringify({ t: "prio", prio: 2 }))).toEqual({ t: "prio", prio: 2 });
    expect(readSyncMessage(JSON.stringify({ t: "prio", prio: 1.5 }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ t: "pause", reason: "x".repeat(400) }))).toEqual({ t: "pause", reason: "x".repeat(300) });
    expect(readSyncMessage(JSON.stringify({ t: "pause", reason: "" }))).toBeNull();
    expect(readSyncMessage(JSON.stringify({ t: "other" }))).toBeNull();
    expect(readSyncMessage("[]")).toBeNull();
    expect(readSyncMessage("{")).toBeNull();
  });

  it("splits a big message into frags and joins them back", () => {
    const big: SyncMessage = { t: "change", path: "big.bin", state: SHA, base: "HEAD", data: "x".repeat(CHUNK * 2 + 5) };
    const texts = frame(big, "f1");
    expect(texts.length).toBe(3);
    expect(texts.every((t) => t.length < CHUNK + 200)).toBe(true);
    const read = unframer();
    expect(read(texts[0]!)).toBeNull();
    expect(read(texts[1]!)).toBeNull();
    expect(read(texts[2]!)).toEqual(big);
    const small: SyncMessage = { t: "prio", prio: 1 };
    expect(frame(small, "f2")).toEqual([JSON.stringify(small)]);
    expect(read(JSON.stringify(small))).toEqual(small);
  });

  it("drops a message whose frags come out of turn", () => {
    const big: SyncMessage = { t: "change", path: "big.bin", state: SHA, base: "HEAD", data: "x".repeat(CHUNK * 2) };
    const [a, b, c] = frame(big, "f1");
    const read = unframer();
    expect(read(b!)).toBeNull();
    expect(read(a!)).toBeNull();
    expect(read(c!)).toBeNull();
    expect(read(JSON.stringify({ t: "frag", id: "z", i: 0, n: 1, s: "" }))).toBeNull();
    expect(read("{")).toBeNull();
  });
});
