// The worker's end of manual QA mode's wire (lib/worker-device-link.ts): a build's trip to R2 goes through the
// key-checked route, then straight to R2 as a stream.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceLink } from "./worker-device-link";

const reg = () => ({
  deviceCall: vi.fn(() => Promise.resolve("call-1")),
  deviceResult: vi.fn(() => Promise.resolve({ status: "pending", result: null, error: null })),
  deviceCancel: vi.fn(() => Promise.resolve(true)),
});

const SHA = "a".repeat(64);
const BUILD = { sha: SHA, kind: "apk" as const, bytes: 5 };

let dir = "";

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-link-")));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("deviceLink", () => {
  it("passes the calls through to the registry", async () => {
    const r = reg();
    const link = deviceLink(r as never, "wwk_key");
    expect(await link.call("udid-1", "card-1", "tap", { element: "Login" })).toBe("call-1");
    expect(r.deviceCall).toHaveBeenCalledWith("udid-1", "card-1", "tap", { element: "Login" });
    await link.result("call-1");
    expect(r.deviceResult).toHaveBeenCalledWith("call-1");
    expect(await link.cancel("call-1")).toBe(true);
    expect(r.deviceCancel).toHaveBeenCalledWith("call-1");
  });

  it("asks the route for a presigned url, then puts the build there", async () => {
    const file = path.join(dir, "app.apk");
    fs.writeFileSync(file, "apk bytes");
    const fetcher = vi.fn((url: string) => Promise.resolve(url.endsWith("/api/worker-build") ? new Response(JSON.stringify({ url: "https://r2.test/qa-builds/o/w/sha" }), { status: 200 }) : new Response("", { status: 200 })));
    const link = deviceLink(reg() as never, "wwk_key", "https://weft.test", fetcher as unknown as typeof fetch);
    await link.upload(file, BUILD);

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://weft.test/api/worker-build");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer wwk_key", "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ sha: SHA, bytes: 5 }));

    const [putUrl, putInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(putUrl).toBe("https://r2.test/qa-builds/o/w/sha");
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toMatchObject({ "content-length": "5", "content-type": "application/octet-stream" });
  });

  it("throws when the route refuses the build", async () => {
    const file = path.join(dir, "app.apk");
    fs.writeFileSync(file, "apk bytes");
    const fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "That key isn't a worker's." }), { status: 401 })));
    const link = deviceLink(reg() as never, "wwk_key", "https://weft.test", fetcher);
    await expect(link.upload(file, BUILD)).rejects.toThrow("That key isn't a worker's.");
  });

  it("throws when the route says nothing useful", async () => {
    const file = path.join(dir, "app.apk");
    fs.writeFileSync(file, "apk bytes");
    const fetcher = vi.fn(() => Promise.resolve(new Response("not json", { status: 500 })));
    const link = deviceLink(reg() as never, "wwk_key", "https://weft.test", fetcher);
    await expect(link.upload(file, BUILD)).rejects.toThrow("HTTP 500");
  });

  it("throws when R2 refuses the put", async () => {
    const file = path.join(dir, "app.apk");
    fs.writeFileSync(file, "apk bytes");
    const fetcher = vi.fn((url: string) => Promise.resolve(url.endsWith("/api/worker-build") ? new Response(JSON.stringify({ url: "https://r2.test/put" }), { status: 200 }) : new Response("", { status: 403 })));
    const link = deviceLink(reg() as never, "wwk_key", "https://weft.test", fetcher as unknown as typeof fetch);
    await expect(link.upload(file, BUILD)).rejects.toThrow("R2 said 403");
  });
});
