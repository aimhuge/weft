// The shim's runner on a worker (electron/connector-exec.cjs): the token from the sealed store into the real CLI's env
// only, the CLI's own ways to print it or run other code refused, and an off, expired or damaged store said plainly.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main, refusal, subcommand } from "./connector-exec.cjs";
import { seal } from "./worker-seal.cjs";
import { newSealKeys } from "../lib/worker-seal";

const keys = newSealKeys();
const NOW = 1_000_000;

function home(entries: Record<string, unknown> | null = {}, withKeys = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-connector-exec-"));
  if (withKeys) fs.writeFileSync(path.join(dir, "seal-key.json"), JSON.stringify(keys));
  if (entries) fs.writeFileSync(path.join(dir, "connectors.json"), JSON.stringify(entries));
  return dir;
}
const stored = (connector: string, over: Record<string, unknown> = {}) => ({ sealed: seal(keys.publicKey, JSON.stringify({ token: "tok-123456", account: "me@example.com" }), `connector-store:${connector}`), bin: `/usr/bin/${connector}`, expiresAt: NOW + 60_000, ...over });

function run(argv: string[]) {
  const child = new EventEmitter();
  const spawnImpl = vi.fn(() => child);
  const exits: number[] = [];
  let err = "";
  main({ argv, env: { PATH: "/x", HOME: "/h" }, spawnImpl: spawnImpl as never, exit: (c: number) => exits.push(c), stderr: { write: (s: string) => (err += s) }, now: () => NOW });
  return { child, spawnImpl, exits, err: () => err };
}

describe("connector-exec", () => {
  it("runs the recorded gog with the token and account in its env, in a home of its own", () => {
    const dir = home({ gog: stored("gog") });
    const r = run([dir, "gog", "-a", "me@example.com", "gmail", "search", "x"]);
    expect(r.spawnImpl).toHaveBeenCalledWith("/usr/bin/gog", ["-a", "me@example.com", "gmail", "search", "x"], { stdio: "inherit", env: { PATH: "/x", HOME: "/h", GOG_HOME: path.join(dir, "connectors", "gog"), GOG_ACCESS_TOKEN: "tok-123456", GOG_ACCOUNT: "me@example.com" } });
    r.child.emit("exit", 3, null);
    r.child.emit("exit", null, "SIGTERM");
    r.child.emit("exit", null, null);
    expect(r.exits).toEqual([3, 1, 0]);
  });

  it("gives gh its token and its own config and data folders, so no planted alias or extension runs", () => {
    const dir = home({ gh: stored("gh") });
    const r = run([dir, "gh", "pr", "list"]);
    expect(r.spawnImpl).toHaveBeenCalledWith("/usr/bin/gh", ["pr", "list"], { stdio: "inherit", env: { PATH: "/x", HOME: "/h", GH_CONFIG_DIR: path.join(dir, "connectors", "gh", "config"), XDG_DATA_HOME: path.join(dir, "connectors", "gh", "data"), GH_TOKEN: "tok-123456" } });
    r.child.emit("error", new Error("ENOENT"));
    expect(r.err()).toBe("ENOENT\n");
  });

  it.each([
    [["gh", "auth", "token"], "gh auth isn't available"],
    [["gh", "alias", "set", "x", "!env"], "gh alias"],
    [["gh", "extension", "install", "x"], "gh extension"],
    [["gog", "--account", "a", "auth", "tokens", "export"], "gog auth"],
  ])("refuses %o", (args, why) => {
    const r = run([home({ gh: stored("gh"), gog: stored("gog") }), ...args]);
    expect(r.spawnImpl).not.toHaveBeenCalled();
    expect(r.err()).toContain(why);
    expect(r.exits).toEqual([1]);
  });

  it("says when it's off, expired, unopenable, or not a connector", () => {
    expect(run([home(null), "gh", "pr"]).err()).toContain("is off for this worker");
    expect(run([home({ gh: stored("gh") }, false), "gh", "pr"]).err()).toContain("is off for this worker");
    expect(run([home({ gh: stored("gh", { bin: undefined }) }), "gh", "pr"]).err()).toContain("is off");
    expect(run([home({ gh: stored("gh", { expiresAt: NOW }) }), "gh", "pr"]).err()).toContain("has expired");
    expect(run([home({ gh: stored("gog") }), "gh", "pr"]).err()).toContain("won't open");
    expect(run([home({}), "slack", "x"]).err()).toBe("Unknown connector.\n");
    expect(run([]).err()).toBe("Unknown connector.\n");
  });

  it("finds the subcommand past flags and their values", () => {
    expect(subcommand(["-a", "x", "--json", "auth"])).toBe("auth");
    expect(subcommand(["--client", "c", "gmail"])).toBe("gmail");
    expect(subcommand(["--json"])).toBe("");
    expect(refusal("gh", ["issue", "create", "--title", "auth"])).toBeNull();
  });
});
