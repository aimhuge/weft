import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { folderReporter, listProjectFolders } from "./worker-folders";

describe("listProjectFolders", () => {
  it("lists the checkouts, sorted, without hidden folders or files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-folders-"));
    for (const dir of ["zeta", "ling-2.0", ".cache"]) fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, "notes.txt"), "");
    expect(listProjectFolders(root)).toEqual(["ling-2.0", "zeta"]);
    fs.rmSync(root, { recursive: true });
  });

  it("reads a missing root as no projects", () => {
    expect(listProjectFolders("/nowhere/at/all")).toEqual([]);
  });
});

describe("folderReporter", () => {
  it("reports only when the folders change", async () => {
    let folders = ["a"];
    const report = vi.fn().mockResolvedValue(undefined);
    const beat = folderReporter(() => folders, report);
    await beat();
    await beat();
    expect(report).toHaveBeenCalledTimes(1);
    folders = ["a", "b"];
    await beat();
    expect(report).toHaveBeenLastCalledWith(["a", "b"]);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("tries again after a failed report", async () => {
    const report = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const beat = folderReporter(() => ["a"], report);
    await expect(beat()).rejects.toThrow("down");
    await beat();
    expect(report).toHaveBeenCalledTimes(2);
  });
});
