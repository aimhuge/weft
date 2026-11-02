import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { workerSigning, workerWidenFor } from "./worker-signing";

describe("workerWidenFor", () => {
  it("builds the worker's widening side from its home, id and work root", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wsign-"));
    const nameFolder = vi.fn();
    const w = workerWidenFor({ home, workerId: "w1", root: "/w", listFolders: (root) => [`${root}:a`], repoPath: (root, f) => `${root}/${f}`, nameFolder, env: {} });
    expect(w.host).toBe("w1");
    expect(w.projects()).toEqual(["/w:a"]);
    expect(w.projectPath("a")).toBe("/w/a");
    expect(w).toMatchObject({ nameFolder });
    expect(w.nonces.take("abcdefghijklmnop", Date.now() + 1000)).toBe(true);
    expect(fs.existsSync(path.join(home, "widen-nonces.json"))).toBe(true);
    expect((await w.signers.verify({ device: "d", message: "m", sig: "s" })).ok).toBe(false);
    expect(workerWidenFor({ home, workerId: "w1", root: "/w", listFolders: () => [], repoPath: () => "", nameFolder }).root).toBe("/w");
  });

  it("hands the line a terminal that checks the same approvals", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wsign-"));
    const spawn = vi.fn();
    const { widen, terminal } = workerSigning({ home, workerId: "w1", root: "/w", listFolders: () => ["a"], repoPath: (r, f) => `${r}/${f}`, nameFolder: vi.fn(), env: {} }, spawn);
    expect(widen.host).toBe("w1");
    expect(terminal.spawn).toBe(spawn);
    await expect(terminal.allow("a", undefined)).rejects.toThrow(/approval/);
    expect(workerSigning({ home, workerId: "w1", root: "/w", listFolders: () => [], repoPath: () => "", nameFolder: vi.fn(), env: {} }).terminal.spawn).toBeTypeOf("function");
  });
});
