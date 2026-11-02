import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cdpOver, chromiumArgs, chromiumCandidates, findChromium, launchChromium, NO_CHROMIUM, pipeReader, quietly } from "./worker-chromium";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-chromium-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("quietly", () => {
  it("drops a rejection nobody waits on", async () => {
    const failed = Promise.reject(new Error("page gone"));
    quietly(failed);
    await expect(failed).rejects.toThrow("page gone");
  });
});

describe("pipeReader", () => {
  it("splits NUL-terminated JSON across chunks, and skips a frame that isn't JSON", () => {
    const got: unknown[] = [];
    const read = pipeReader((m) => got.push(m));
    read('{"id":1}\0{"me');
    read(Buffer.from('thod":"x"}\0nope\0'));
    expect(got).toEqual([{ id: 1 }, { method: "x" }]);
  });
});

function pair(callMs?: number) {
  const out = new PassThrough();
  const inn = new PassThrough();
  const written: Array<Record<string, unknown>> = [];
  out.on("data", (d: Buffer) => d.toString().split("\0").filter(Boolean).forEach((m) => written.push(JSON.parse(m) as Record<string, unknown>)));
  const kill = vi.fn();
  return { out, inn, written, kill, cdp: cdpOver(out, inn, kill, callMs), reply: (m: object) => inn.write(`${JSON.stringify(m)}\0`) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("cdpOver", () => {
  it("answers each call by id, with a session when given, and passes events on", async () => {
    const p = pair();
    const events: unknown[] = [];
    const off = p.cdp.on((e) => events.push(e));
    const a = p.cdp.send("Target.createTarget", { url: "about:blank" });
    const b = p.cdp.send("Page.enable", undefined, "s1");
    await tick();
    expect(p.written).toEqual([
      { id: 1, method: "Target.createTarget", params: { url: "about:blank" } },
      { id: 2, method: "Page.enable", params: {}, sessionId: "s1" },
    ]);
    p.reply({ id: 2, error: { message: "nope" } });
    p.reply({ id: 1, result: { targetId: "t1" } });
    p.reply({ id: 9 });
    p.reply({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "s1" });
    p.reply({ method: "Target.targetCreated" });
    p.reply({ result: {} });
    await expect(a).resolves.toEqual({ targetId: "t1" });
    await expect(b).rejects.toThrow("nope");
    expect(events).toEqual([
      { method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "s1" },
      { method: "Target.targetCreated", params: {} },
    ]);
    off();
    p.reply({ method: "Later" });
    await tick();
    expect(events).toHaveLength(2);
  });

  it("fails a call the browser never answers, and ignores a late answer", async () => {
    const p = pair(10);
    await expect(p.cdp.send("Page.navigate", { url: "http://hang.test" })).rejects.toThrow("didn't answer Page.navigate in 0.01s");
    p.reply({ id: 1, result: {} });
    await tick();
    expect(p.cdp.closed).toBe(false);
  });

  it("says the browser refused when an error has no message, and answers {} for no result", async () => {
    const p = pair();
    const a = p.cdp.send("A");
    const b = p.cdp.send("B");
    p.reply({ id: 1, error: {} });
    p.reply({ id: 2 });
    await expect(a).rejects.toThrow("The browser refused that.");
    await expect(b).resolves.toEqual({});
  });

  it("rejects what's waiting and anything after it closes, and tells its listeners once", async () => {
    const p = pair();
    const closed = vi.fn();
    p.cdp.onClose(closed);
    const waiting = p.cdp.send("A");
    p.inn.emit("close");
    p.inn.emit("error", new Error("x"));
    await expect(waiting).rejects.toThrow("closed");
    await expect(p.cdp.send("B")).rejects.toThrow("closed");
    expect(p.cdp.closed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    p.cdp.close();
    expect(p.kill).toHaveBeenCalled();
  });
});

describe("chromiumCandidates and findChromium", () => {
  it("tries WEFT_CHROMIUM, Weft's own, Playwright's newest shells, then the system's", () => {
    const home = path.join(tmp, "home");
    const caches = path.join(home, ".cache", "ms-playwright");
    for (const d of ["chromium_headless_shell-1200/chrome-headless-shell-linux64", "chromium_headless_shell-1228/chrome-headless-shell-linux64", "chromium_headless_shell-next/chrome-headless-shell-linux64", "chromium-1228"]) fs.mkdirSync(path.join(caches, d), { recursive: true });
    fs.writeFileSync(path.join(caches, "chromium_headless_shell-9"), "");
    const linux = chromiumCandidates({ WEFT_CHROMIUM: "/x/chrome" } as unknown as NodeJS.ProcessEnv, home, "linux");
    expect(linux.slice(0, 4)).toEqual([
      "/x/chrome",
      path.join(home, ".weft", "tools", "chromium", "chrome-headless-shell"),
      path.join(caches, "chromium_headless_shell-1228", "chrome-headless-shell-linux64", "chrome-headless-shell"),
      path.join(caches, "chromium_headless_shell-1200", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    ]);
    expect(linux).toContain(path.join(caches, "chromium_headless_shell-next", "chrome-headless-shell-linux64", "chrome-headless-shell"));
    expect(linux).toContain("/usr/bin/chromium");
    const mac = chromiumCandidates({} as NodeJS.ProcessEnv, path.join(tmp, "nobody"), "darwin");
    expect(mac[0]).toBe(path.join(tmp, "nobody", ".weft", "tools", "chromium", "chrome-headless-shell"));
    expect(mac).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("finds the first executable file", () => {
    const exe = path.join(tmp, "chrome");
    fs.writeFileSync(exe, "#!/bin/sh\n");
    fs.chmodSync(exe, 0o755);
    const plain = path.join(tmp, "plain");
    fs.writeFileSync(plain, "");
    expect(findChromium([path.join(tmp, "missing"), plain, tmp, exe])).toBe(exe);
    expect(findChromium([path.join(tmp, "missing")])).toBeNull();
  });
});

describe("chromiumArgs", () => {
  it("is headless over a pipe with its own profile, and sandboxed unless it runs as root", () => {
    const args = chromiumArgs("/tmp/p", false);
    expect(args).toEqual(expect.arrayContaining(["--headless=new", "--remote-debugging-pipe", "--user-data-dir=/tmp/p"]));
    expect(args).not.toContain("--no-sandbox");
    expect(args.some((a) => a.startsWith("--remote-debugging-port"))).toBe(false);
    expect(chromiumArgs("/tmp/p", true)).toContain("--no-sandbox");
    expect(Array.isArray(chromiumArgs("/tmp/p"))).toBe(true);
  });
});

describe("launchChromium", () => {
  it("says how to get a Chromium when there's none", () => {
    expect(() => launchChromium(null)).toThrow(NO_CHROMIUM);
  });

  it("spawns a real process with the pipes, and closes when it exits", async () => {
    const cdp = launchChromium("/usr/bin/false");
    await vi.waitFor(() => expect(cdp.closed).toBe(true));
  });

  it("spawns it on pipes 3 and 4, and removes its profile when it exits or fails to start", () => {
    for (const end of ["exit", "error"]) {
      const child = Object.assign(new EventEmitter(), { stdio: [null, null, null, new PassThrough(), new PassThrough()], kill: vi.fn() });
      let dir = "";
      const cdp = launchChromium("/bin/chrome", (bin, args) => {
        expect(bin).toBe("/bin/chrome");
        dir = (args.find((a) => a.startsWith("--user-data-dir=")) ?? "").slice("--user-data-dir=".length);
        return child as never;
      });
      expect(fs.existsSync(dir)).toBe(true);
      child.emit(end, new Error("x"));
      expect(cdp.closed).toBe(true);
      expect(child.kill).toHaveBeenCalled();
      expect(fs.existsSync(dir)).toBe(false);
    }
  });
});
