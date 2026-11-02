// A worker's side of manual QA mode (lib/worker-device.ts): where a device tool call goes, and what happens when
// the Mac doesn't answer. The Mac's refusal is not an outage: it comes back as the refusal, and the local device
// never runs behind it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ToolResult } from "./browser-shell";

const getCard = vi.hoisted(() => vi.fn());
vi.mock("./store", () => ({ getCard }));

const savePng = vi.hoisted(() => vi.fn((file: string) => file));
vi.mock("./browser-tools", () => ({ savePng }));

const { deviceRoute, packBuild, setDeviceLink } = await import("./worker-device");
type DeviceLink = import("./worker-device").DeviceLink;

const local = (result: ToolResult = { content: [{ type: "text", text: "local" }] }) => vi.fn(() => Promise.resolve(result));

beforeEach(() => {
  vi.clearAllMocks();
  setDeviceLink(null);
  getCard.mockReturnValue(undefined);
});

afterEach(() => setDeviceLink(null));

// A link that answers the way the Mac does.
const link = (over: Partial<Record<keyof DeviceLink, Mock>> = {}) => {
  const made: Record<keyof DeviceLink, Mock> = {
    call: vi.fn(() => Promise.resolve("call-1")),
    result: vi.fn(() => Promise.resolve({ status: "done", result: { content: [{ type: "text", text: "mac" }] }, error: null })),
    cancel: vi.fn(() => Promise.resolve(true)),
    upload: vi.fn(() => Promise.resolve()),
    ...over,
  };
  setDeviceLink(made);
  return made;
};

describe("deviceRoute", () => {
  it("runs locally when the card has no qa device", async () => {
    const run = local();
    const out = await deviceRoute("card-1", "tap", {}, run);
    expect(out).toEqual({ content: [{ type: "text", text: "local" }] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs locally when there is no card", async () => {
    const run = local();
    await deviceRoute(undefined, "tap", {}, run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs locally when there is no link to the Mac", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const run = local();
    await deviceRoute("card-1", "tap", {}, run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs locally for a tool that isn't a device tool", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const to = link();
    const run = local();
    await deviceRoute("card-1", "shell", {}, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(to.call).not.toHaveBeenCalled();
  });

  it("runs the call on the Mac and returns its answer", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const to = link();
    const run = local();
    const out = await deviceRoute("card-1", "tap", { element: "Login" }, run);
    expect(to.call).toHaveBeenCalledWith("udid-1", "card-1", "tap", { element: "Login" });
    expect(out).toEqual({ content: [{ type: "text", text: "mac" }] });
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to the local device when the Mac gives no call id, saying so first", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    link({ call: vi.fn(() => Promise.resolve(null)) });
    const run = local();
    const out = await deviceRoute("card-1", "tap", {}, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect((out.content[0] as { text: string }).text).toContain("didn't answer");
    expect(out.content[0]?.type).toBe("text");
    expect(out.content).toHaveLength(2);
  });

  it("falls back to the local device when a pending call is cancelled after 20 seconds", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const to = link({
      result: vi.fn(() => Promise.resolve({ status: "pending", result: null, error: null })),
      cancel: vi.fn(() => Promise.resolve(true)),
    });
    let clock = 0;
    const run = local();
    const out = await deviceRoute("card-1", "tap", {}, run, () => Promise.resolve(), () => (clock += 25_000));
    expect(to.cancel).toHaveBeenCalledWith("call-1");
    expect(run).toHaveBeenCalledTimes(1);
    expect((out.content[0] as { text: string }).text).toContain("didn't answer");
  });

  it("keeps waiting when a pending call can't be cancelled", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    let clock = 0;
    const to = link({
      result: vi.fn(() => Promise.resolve({ status: "pending", result: null, error: null })),
      cancel: vi.fn(() => Promise.resolve(false)),
    });
    const run = local();
    const out = await deviceRoute("card-1", "tap", {}, run, () => Promise.resolve(), () => (clock += 25_000));
    expect(to.cancel).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    // The Mac took it and hasn't answered: the agent is told it may have run.
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toContain("may have run");
  });

  it("returns the Mac's refusal as an error, and never runs locally behind it", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    link({ result: vi.fn(() => Promise.resolve({ status: "failed", result: null, error: "Manual QA isn't switched on." })) });
    const run = local();
    const out = await deviceRoute("card-1", "tap", {}, run);
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toBe("Manual QA isn't switched on.");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the Mac's refusal with its own wording when it gives none", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    link({ result: vi.fn(() => Promise.resolve({ status: "failed", result: null, error: null })) });
    const out = await deviceRoute("card-1", "tap", {}, local());
    expect((out.content[0] as { text: string }).text).toBe("The Mac couldn't run that.");
  });

  it("returns the Mac's failure without running locally", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-upload-")));
    const apk = path.join(dir, "app.apk");
    fs.writeFileSync(apk, "apk bytes");
    const to = link();
    to.upload.mockRejectedValue(new Error("R2 said 500"));
    const run = local();
    const out = await deviceRoute("card-1", "install", { path: apk }, run);
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toBe("R2 said 500");
    expect(run).not.toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("strips save_to from the args it sends, and writes the picture here", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const to = link({
      result: vi.fn(() => Promise.resolve({ status: "done", result: { content: [{ type: "image", data: "AAA", mimeType: "image/png" }] }, error: null })),
    });
    const out = await deviceRoute("card-1", "screenshot", { save_to: "/tmp/shot.png" }, local());
    expect(to.call).toHaveBeenCalledWith("udid-1", "card-1", "screenshot", {});
    expect(savePng).toHaveBeenCalledWith("/tmp/shot.png", "AAA");
    expect((out.content.at(-1) as { text: string }).text).toContain("Saved to /tmp/shot.png");
  });

  it("doesn't write anything when the answer has no picture", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    link();
    const out = await deviceRoute("card-1", "tap", { save_to: "/tmp/shot.png" }, local());
    expect(savePng).not.toHaveBeenCalled();
    expect(out).toEqual({ content: [{ type: "text", text: "mac" }] });
  });

  it("sends an install as a build, never a path", async () => {
    getCard.mockReturnValue({ id: "card-1", qaDevice: "udid-1" });
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-install-")));
    const apk = path.join(dir, "app.apk");
    fs.writeFileSync(apk, "apk bytes");
    const to = link();
    const out = await deviceRoute("card-1", "install", { path: apk }, local());
    const args = to.call.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(args).toHaveProperty("build");
    expect(args).not.toHaveProperty("path");
    expect((args.build as { kind: string }).kind).toBe("apk");
    expect(to.upload).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ content: [{ type: "text", text: "mac" }] });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("packBuild", () => {
  let dir = "";

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-pack-")));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("packs an .apk and names its hash", async () => {
    const apk = path.join(dir, "app.apk");
    fs.writeFileSync(apk, "apk bytes");
    const packed = await packBuild(apk, dir);
    expect(packed.file).toBe(apk);
    expect(packed.build.kind).toBe("apk");
    expect(packed.build.bytes).toBe(9);
    expect(packed.build.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(packed.temp).toBe(false);
  });

  it("zips an .app folder, and says the zip is temporary", async () => {
    const app = path.join(dir, "MyApp.app");
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, "Info.plist"), "plist");
    const packed = await packBuild(app, dir);
    expect(packed.build.kind).toBe("app");
    expect(packed.temp).toBe(true);
    expect(packed.file).not.toBe(app);
    expect(fs.existsSync(packed.file)).toBe(true);
    expect(packed.build.bytes).toBeGreaterThan(0);
    expect(packed.build.sha).toMatch(/^[0-9a-f]{64}$/);
    fs.rmSync(packed.file, { force: true });
  });

  it("refuses a file that isn't a built .app or .apk", async () => {
    await expect(packBuild(path.join(dir, "thing.txt"), dir)).rejects.toThrow("built .app folder or an .apk");
  });

  it("says so when the build isn't there", async () => {
    await expect(packBuild(path.join(dir, "gone.apk"), dir)).rejects.toThrow("isn't there. Build it first.");
  });
});
