import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Module scope: outside any hook timeout.
const t0 = Date.now();
const template = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-t-"));
execFileSync("git", ["-C", template, "init", "-q"], { stdio: "ignore" });
console.log("warmup", Date.now() - t0);

describe("dbg", () => {
  it("times the intake", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-r-"));
    fs.cpSync(path.join(template, ".git"), path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, "a.ts"), "x");
    execFileSync("git", ["-C", repo, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-q", "-m", "x"], { stdio: "ignore" });
    console.log("repo ready", Date.now() - t0);
    expect(true).toBe(true);
  });
});
