// Starting a worker's GitHub connector (lib/connector-worker.ts): none on a token-enrolled box; otherwise the socket in
// the worker's home, the setup every session's env gets, and all of it undone on close.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setConnectorSetup, withConnectorEnv } from "./connector-env";
import { startWorkerConnectors, type WorkerConnectorDeps } from "./connector-worker";

const homes: string[] = [];
afterEach(() => {
  setConnectorSetup(null);
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function base(over: Partial<WorkerConnectorDeps> = {}): WorkerConnectorDeps {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wcw-"));
  homes.push(home);
  return { home, workerId: "w1", key: "wwk_k", sign: (m) => `s${m.length}`, weftDir: "/weft", cwdOf: () => undefined, log: vi.fn(), site: "https://weft.test", ...over };
}

describe("startWorkerConnectors", () => {
  it("starts nothing on a box enrolled by token", () => {
    const d = base({ sign: undefined });
    expect(startWorkerConnectors(d)).toBeNull();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("enrolled by token"));
    expect(withConnectorEnv({ A: "1" }, () => "c")).toEqual({ A: "1" });
  });

  it("opens the socket in the worker's home and gives sessions the setup, until closed", async () => {
    const run = vi.fn<(cmd: string, args: string[]) => string>((cmd) => (cmd === "/usr/bin/env" ? "/opt/bin/gh\n" : " !gh auth git-credential \n\nstore\n"));
    const d = base({ run });
    const started = startWorkerConnectors(d);
    expect(started).not.toBeNull();
    const socket = path.join(d.home, "connector.sock");
    await vi.waitFor(() => expect(fs.existsSync(socket)).toBe(true));
    expect(run).toHaveBeenCalledWith("/usr/bin/env", [expect.stringMatching(/^PATH=/), "which", "gh"]);
    expect(run.mock.calls[0]![1][0]).not.toContain("/weft/scripts/worker-bin");
    expect(run).toHaveBeenCalledWith("git", ["config", "--global", "--get-all", "credential.https://github.com.helper"]);
    const env = withConnectorEnv({}, () => "c");
    expect(env).toMatchObject({ WEFT_CONNECTOR_SOCKET: socket, WEFT_CONNECTOR_NODE: process.execPath, WEFT_CONNECTOR_HELPER: "/weft/scripts/weft-connector-helper.cjs", GIT_CONFIG_COUNT: "4", GIT_CONFIG_VALUE_2: "!gh auth git-credential", GIT_CONFIG_VALUE_3: "store" });
    expect(env.PATH?.startsWith("/weft/scripts/worker-bin")).toBe(true);
    started!.close();
    expect(fs.existsSync(socket)).toBe(false);
    expect(withConnectorEnv({ A: "1" }, () => "c")).toEqual({ A: "1" });
  });

  it("carries on with no gh and no box helpers when the commands fail", () => {
    const started = startWorkerConnectors(
      base({
        run: () => {
          throw new Error("not found");
        },
      }),
    );
    expect(withConnectorEnv({}, () => "c").GIT_CONFIG_COUNT).toBe("2");
    started!.close();
  });

  it("asks weft.zip with a fresh nonce, finding gh and git's helpers itself", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json({ token: "t", expiresAt: "2099-01-01T00:00:00Z" })));
    vi.stubGlobal("fetch", fetch);
    const PATH = process.env.PATH;
    delete process.env.PATH;
    const d = base({ site: undefined, run: undefined });
    const repo = path.join(d.home, "r");
    execFileSync("/usr/bin/git", ["init", "-q", repo]);
    execFileSync("/usr/bin/git", ["-C", repo, "remote", "add", "origin", "https://github.com/o/r"]);
    let started: ReturnType<typeof startWorkerConnectors> = null;
    try {
      started = startWorkerConnectors({ ...d, cwdOf: () => repo });
    } finally {
      process.env.PATH = PATH;
    }
    const cap = withConnectorEnv({}, () => "card").WEFT_CONNECTOR_CAP;
    const socket = path.join(d.home, "connector.sock");
    await vi.waitFor(() => expect(fs.existsSync(socket)).toBe(true));
    const reply = await new Promise<string>((resolve) => {
      const c = net.createConnection(socket);
      let buf = "";
      c.setEncoding("utf8");
      c.on("data", (s: string) => (buf += s));
      c.on("end", () => resolve(buf));
      c.write(`${JSON.stringify({ cap, op: "get" })}\n`);
    });
    expect(JSON.parse(reply)).toMatchObject({ token: "t", gh: null, path: "" });
    expect(fetch.mock.calls[0]![0]).toMatch(/\/api\/connectors\/github\/mint$/);
    expect((JSON.parse(fetch.mock.calls[0]![1]?.body as string) as { nonce: string }).nonce).toMatch(/^[0-9a-f]{64}$/);
    started!.close();
    vi.unstubAllGlobals();
  });
});
