import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloudflared-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));
const { ASSETS, ensureCloudflared, startQuickTunnel, VERSION } = await import("./tunnel-cloudflared");

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), stdout: new EventEmitter(), kill: vi.fn() });
  return child;
}
const launch = (child: ReturnType<typeof fakeChild>) => vi.fn(() => child) as never;

beforeEach(() => fs.rmSync(path.join(dir, "bin"), { recursive: true, force: true }));

describe("fetching cloudflared", () => {
  const body = Buffer.from("program");
  const sha256 = createHash("sha256").update(body).digest("hex");

  it("installs a download that matches its digest", async () => {
    ASSETS["test-os"] = { file: "cloudflared-test", sha256 };
    const got = await ensureCloudflared("test-os", () => Promise.resolve(new Response(body)));
    expect(fs.readFileSync(got, "utf8")).toBe("program");
    expect(fs.statSync(got).mode & 0o111).not.toBe(0);
    expect(got).toContain(VERSION);
  });

  it("refuses a download that doesn't, and leaves nothing to run", async () => {
    ASSETS["test-os"] = { file: "cloudflared-test", sha256: "0".repeat(64) };
    await expect(ensureCloudflared("test-os", () => Promise.resolve(new Response(body)))).rejects.toThrow(/checksum/);
    expect(fs.existsSync(path.join(dir, "bin", `cloudflared-${VERSION}`))).toBe(false);
  });

  it("says when the platform has no build, or the fetch fails", async () => {
    await expect(ensureCloudflared("plan9-mips")).rejects.toThrow(/don't run on plan9-mips/);
    ASSETS["test-os"] = { file: "cloudflared-test", sha256 };
    await expect(ensureCloudflared("test-os", () => Promise.resolve(new Response("", { status: 404 })))).rejects.toThrow(/404/);
  });
});

describe("a quick tunnel", () => {
  it("answers with the URL cloudflared logs", async () => {
    const child = fakeChild();
    const started = startQuickTunnel("/bin/x", 1234, vi.fn(), launch(child));
    child.stderr.emit("data", Buffer.from("INF |  https://calm-river.trycloudflare.com  |"));
    expect((await started).url).toBe("https://calm-river.trycloudflare.com");
  });

  it("tells the caller when it ends by itself, but not on stop", async () => {
    const onExit = vi.fn();
    const child = fakeChild();
    const started = startQuickTunnel("/bin/x", 1, onExit, launch(child));
    child.stdout.emit("data", Buffer.from("https://a.trycloudflare.com"));
    const quick = await started;
    child.emit("exit");
    expect(onExit).toHaveBeenCalledOnce();

    const quiet = vi.fn();
    const second = fakeChild();
    const again = startQuickTunnel("/bin/x", 1, quiet, launch(second));
    second.stdout.emit("data", Buffer.from("https://b.trycloudflare.com"));
    (await again).stop();
    second.emit("exit");
    expect(quiet).not.toHaveBeenCalled();
    expect(quick.url).toContain("a.try");
  });

  it("stops with the server, and lets go of the hook once it has ended", async () => {
    const before = process.listenerCount("exit");
    const child = fakeChild();
    const started = startQuickTunnel("/bin/x", 1, vi.fn(), launch(child));
    child.stdout.emit("data", Buffer.from("https://a.trycloudflare.com"));
    await started;
    expect(process.listenerCount("exit")).toBe(before + 1);
    process.listeners("exit").at(-1)?.call(process, 0);
    expect(child.kill).toHaveBeenCalled();
    child.emit("exit");
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("fails when cloudflared stops, errors or stays silent", async () => {
    const early = fakeChild();
    const stopped = startQuickTunnel("/bin/x", 1, vi.fn(), launch(early));
    early.emit("exit");
    await expect(stopped).rejects.toThrow(/before it gave a URL/);

    const broken = fakeChild();
    const errored = startQuickTunnel("/bin/x", 1, vi.fn(), launch(broken));
    broken.emit("error", new Error("ENOENT"));
    await expect(errored).rejects.toThrow("ENOENT");

    const silent = fakeChild();
    await expect(startQuickTunnel("/bin/x", 1, vi.fn(), launch(silent), 5)).rejects.toThrow(/in time/);
    expect(silent.kill).toHaveBeenCalled();
  });
});
