import { describe, expect, it } from "vitest";
import * as cjs from "../electron/worker-keep-wire.cjs";
import { parseRemote } from "../electron/vault-id.cjs";
import { KEEP_ENVIRONMENTS, KEEP_KIND, keepMessage, keptPurpose, keptVersions, readKeep, repoOfRemote, type Keep } from "./worker-keep-wire";

const sealed = { v: 1, epk: "ZXBr", iv: "aXY=", ct: "Y3Q=", tag: "dGFn" };
const mac = { key: "a".repeat(43) + "=", sig: "b".repeat(86) + "==" };
const put = { worker: "w1", seq: 5, issuedAt: 1000, op: "put", repo: "github:o/r", environment: "development", entries: [{ name: "A", version: 5, sealed }] };

describe("main's copy", () => {
  it("signs the same message and seals for the same purpose", () => {
    const keeps: Keep[] = [put as Keep, { worker: "w1", seq: 6, issuedAt: 2, op: "delete", repo: "github:o/r", environment: "preview", names: ["B", "A"] }, { worker: "w1", seq: 7, issuedAt: 3, op: "wipe" }];
    for (const k of keeps) expect(cjs.keepMessage(k)).toBe(keepMessage(k));
    expect(cjs.keptPurpose("w", "github:o/r", "development", "A", 3)).toBe(keptPurpose("w", "github:o/r", "development", "A", 3));
    expect(cjs.KEEP_KIND).toBe(KEEP_KIND);
    expect(cjs.KEEP_ENVIRONMENTS).toEqual([...KEEP_ENVIRONMENTS]);
  });

  it("names a remote's vault as electron/vault-id.cjs does", () => {
    for (const remote of ["git@github.com:Owner/Repo.git", "https://github.com/owner/repo", "https://x@github.com/o/r.git/", "ssh://git@github.com/o/r"]) {
      expect(repoOfRemote(remote)).toBe(parseRemote(remote)?.id);
    }
    expect(repoOfRemote("git@gitlab.com:o/r.git")).toBeNull();
    expect(repoOfRemote("nonsense")).toBeNull();
    expect(repoOfRemote("https://github.com/o/r/extra")).toBeNull();
  });
});

describe("readKeep", () => {
  it("reads each op", () => {
    expect(readKeep({ keep: put, mac })?.keep).toEqual(put);
    expect((readKeep({ keep: { ...put, op: "delete", entries: undefined, names: ["A", "A"] }, mac })?.keep as { names?: string[] } | undefined)?.names).toEqual(["A"]);
    expect(readKeep({ keep: { worker: "w1", seq: 1, issuedAt: 1, op: "drop", repo: "github:o/r", environment: "preview" }, mac })?.keep).toEqual({ worker: "w1", seq: 1, issuedAt: 1, op: "drop", repo: "github:o/r", environment: "preview" });
    expect(readKeep({ keep: { worker: "w1", seq: 1, issuedAt: 1, op: "wipe", repo: "ignored" }, mac })?.keep).toEqual({ worker: "w1", seq: 1, issuedAt: 1, op: "wipe" });
  });

  it("refuses anything else", () => {
    const bad: unknown[] = [
      null,
      { keep: put },
      { keep: put, mac: { key: "!", sig: mac.sig } },
      { keep: put, mac: { key: mac.key, sig: 1 } },
      { keep: { ...put, op: "steal" }, mac },
      { keep: { ...put, worker: "bad id" }, mac },
      { keep: { ...put, seq: 0 }, mac },
      { keep: { ...put, issuedAt: 1.5 }, mac },
      { keep: { ...put, environment: "production" }, mac },
      { keep: { ...put, repo: "gitlab:o/r" }, mac },
      { keep: { ...put, entries: [] }, mac },
      { keep: { ...put, entries: [{ name: "1A", version: 1, sealed }] }, mac },
      { keep: { ...put, entries: [{ name: "A", version: 1, sealed: { v: 2 } }] }, mac },
      { keep: { ...put, entries: [{ name: "A", version: 1, sealed }, { name: "A", version: 2, sealed }] }, mac },
      { keep: { ...put, entries: [null] }, mac },
      { keep: { ...put, entries: Array.from({ length: 201 }, (_, i) => ({ name: `A${i}`, version: 1, sealed })) }, mac },
      { keep: { ...put, op: "delete", names: [] }, mac },
      { keep: { ...put, op: "delete", names: ["ok", "bad name"] }, mac },
    ];
    for (const payload of bad) expect(readKeep(payload)).toBeNull();
  });
});

describe("keptVersions", () => {
  it("takes names with whole versions only", () => {
    expect(keptVersions({ A: 1, B: 2 })).toEqual({ A: 1, B: 2 });
    expect(keptVersions({})).toEqual({});
    expect(keptVersions(null)).toBeNull();
    expect(keptVersions({ A: 0 })).toBeNull();
    expect(keptVersions({ "bad name": 1 })).toBeNull();
    expect(keptVersions(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`A${i}`, 1])))).toBeNull();
  });
});
