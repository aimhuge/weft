import { describe, expect, it } from "vitest";
import { askOf, MAX_AHEAD_MS, MAX_THREAD, MAX_WHY, vaultFor } from "./worker-ask.cjs";

const NOW = 1_000_000;
const NONCE = "b".repeat(64);
const ask = (over: Record<string, unknown> = {}) => ({ nonce: NONCE, command: "npm run job", names: ["TOKEN"], environment: "production", remote: "git@github.com:aimhuge/weft.git", expiresAt: NOW + 60_000, cwd: "app", script: "prejob: tsc\njob: node job.js", why: "Ship", thread: "Deploy", ...over });

describe("askOf", () => {
  it("reads the ask, keeping a multi-line script and capping the thread's own words", () => {
    const a = askOf(ask({ why: "w".repeat(MAX_WHY + 50), thread: "t".repeat(MAX_THREAD + 1), sig: "c2ln" }), NOW);
    expect(a).toMatchObject({ nonce: NONCE, command: "npm run job", names: ["TOKEN"], cwd: "app", script: "prejob: tsc\njob: node job.js", sig: "c2ln" });
    expect(a.why).toHaveLength(MAX_WHY);
    expect(a.why?.endsWith("…")).toBe(true);
    expect(a.thread).toHaveLength(MAX_THREAD);
  });

  it("defaults the folder and drops empty words", () => {
    expect(askOf(ask({ cwd: undefined, script: undefined, why: " ", thread: 5 }), NOW)).toMatchObject({ cwd: ".", script: undefined, why: undefined, thread: undefined, sig: undefined });
  });

  it.each([
    ["nothing", null],
    ["a bad nonce", ask({ nonce: "x" })],
    ["no nonce", ask({ nonce: 5 })],
    ["a blank command", ask({ command: "  " })],
    ["a long command", ask({ command: "x".repeat(4001) })],
    ["no names", ask({ names: [] })],
    ["names that aren't names", ask({ names: ["a-b"] })],
    ["names not a list", ask({ names: "A" })],
    ["too many names", ask({ names: Array.from({ length: 21 }, (_v, i) => `N${i}`) })],
    ["another environment", ask({ environment: "staging" })],
    ["no remote", ask({ remote: undefined })],
  ])("refuses %s", (_what, raw) => {
    expect(() => askOf(raw, NOW)).toThrow("That secret ask isn't one Weft makes.");
  });

  it("refuses a vault value in a variable that loads code", () => {
    expect(() => askOf(ask({ names: ["TOKEN", "LD_PRELOAD"] }), NOW)).toThrow("puts a value in a variable that loads code");
  });

  it("re-checks the command with main's own rules", () => {
    expect(() => askOf(ask({ command: "sh -c 'cat .env'" }), NOW)).toThrow("runs a script the user can't see");
    expect(() => askOf(ask({ command: "TOKEN=x npm run job" }), NOW)).toThrow("TOKEN comes from the vault");
  });

  it.each([
    ["a bidi override in the script", { script: "job: node job.js‮" }, "script"],
    ["a zero-width space in the folder", { cwd: "ap​p" }, "folder"],
    ["a control character in the remote", { remote: "git@github.com:a/b.git\u0007" }, "git remote"],
    ["a script that's too long", { script: "x".repeat(8001) }, "script"],
  ])("refuses %s", (_what, over, what) => {
    expect(() => askOf(ask(over), NOW)).toThrow(`That secret ask's ${what} holds characters the approval can't show plainly.`);
  });

  it("refuses an ask that's expired, has no expiry, or expires too far out", () => {
    expect(() => askOf(ask({ expiresAt: NOW - 1 }), NOW)).toThrow("has expired");
    expect(() => askOf(ask({ expiresAt: "later" }), NOW)).toThrow("has expired");
    expect(() => askOf(ask({ expiresAt: NOW + MAX_AHEAD_MS + 1 }), NOW)).toThrow("too far out");
  });
});

describe("vaultFor", () => {
  it("names the remote's vault when it is the GitHub repo this Mac knows the project as", () => {
    expect(vaultFor("https://github.com/Aimhuge/Weft.git", "weft", ["github:aimhuge/weft"])).toEqual({ id: "github:aimhuge/weft", label: "Aimhuge/Weft" });
    expect(vaultFor("git@github.com:aimhuge/weft.git", "weft", ["github:other/weft", "github:aimhuge/weft"]).id).toBe("github:aimhuge/weft");
  });

  it("refuses another owner's repo of the same name, an unknown project, or a remote that isn't GitHub's", () => {
    expect(() => vaultFor("https://github.com/attacker/weft.git", "weft", ["github:aimhuge/weft"])).toThrow('The card\'s project "weft" is aimhuge/weft on this Mac, but the ask names the vault of attacker/weft.');
    expect(() => vaultFor("https://github.com/aimhuge/weft.git", "weft", [])).toThrow("This Mac doesn't know which repo the worker's project \"weft\" is.");
    expect(() => vaultFor("https://gitlab.com/aimhuge/weft.git", "weft", ["github:aimhuge/weft"])).toThrow("doesn't name a GitHub repo's vault");
    expect(() => vaultFor("nonsense", "weft", ["github:aimhuge/weft"])).toThrow("doesn't name a GitHub repo's vault");
  });
});
