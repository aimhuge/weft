import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The live view of a device: a page in the show folder and a loop that keeps rewriting its frame.jpg.
// The show folder follows WEFT_DATA, so the data dir is pointed at a temp dir before the module loads.
const h = vi.hoisted(() => ({
  screenshot: vi.fn<(d: { id: string }) => Promise<Buffer>>(),
}));

vi.mock("./simulator-devices", () => ({ screenshot: h.screenshot }));

let dataDir: string;
let w: typeof import("./simulator-watch");

const DEV = { id: "SIM-1", name: "iPhone 16", platform: "ios" as const, state: "booted" as const, runtime: "iOS 18.2" };
const OTHER = { id: "emulator-5554", name: "Pixel", platform: "android" as const, state: "booted" as const };

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-watch-"));
  vi.stubEnv("WEFT_DATA", dataDir);
  // A 4x4 PNG, so sharp has real bytes to resize into a JPEG frame.
  h.screenshot.mockResolvedValue(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#336699" } }).png().toBuffer());
  vi.resetModules();
  w = await import("./simulator-watch");
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  h.screenshot.mockResolvedValue(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#336699" } }).png().toBuffer());
  w.stopWatching();
});

afterEach(() => {
  vi.useRealTimers();
});

const showDir = () => path.join(dataDir, "show");
const frameOf = (id: string) => path.join(showDir(), "simulator", id, "frame.jpg");

describe("watchDir", () => {
  it("puts the device's pages under the show folder, in a folder named for the device", () => {
    expect(w.watchDir(DEV)).toBe(path.join(showDir(), "simulator", "SIM-1"));
  });

  it("replaces the characters a path can't take with underscores", () => {
    const messy = { ...DEV, id: "avd:My Phone/2" };
    expect(w.watchDir(messy)).toBe(path.join(showDir(), "simulator", "avd_My_Phone_2"));
  });
});

describe("viewerHtml", () => {
  it("titles the page with the device, its runtime and when the view ends", () => {
    const html = w.viewerHtml(DEV, Date.UTC(2026, 0, 1, 12, 30));
    expect(html).toContain("<title>📱 iPhone 16 · iOS 18.2</title>");
    expect(html).toContain("live until");
    expect(html).toContain("<b>iPhone 16 · iOS 18.2</b>");
  });

  it("leaves the runtime out when the device has none", () => {
    expect(w.viewerHtml(OTHER, Date.now())).toContain("<title>📱 Pixel</title>");
  });

  it("escapes the device name so it can't break the page", () => {
    const evil = { ...DEV, name: '<script>"x"&y</script>' };
    const html = w.viewerHtml(evil, Date.now());
    expect(html).not.toContain("<script>\"x\"");
    expect(html).toContain("&lt;script&gt;&quot;x&quot;&amp;y&lt;/script&gt;");
  });

  it("puts the end time in the page's script so the view can stop itself", () => {
    const until = 1_800_000_000_000;
    expect(w.viewerHtml(DEV, until)).toContain(`const until=${until}`);
  });
});

describe("writeFrame", () => {
  it("writes a JPEG beside the page, named frame.jpg", async () => {
    await w.writeFrame(DEV);
    const file = frameOf("SIM-1");
    expect(fs.existsSync(file)).toBe(true);
    const meta = await sharp(fs.readFileSync(file)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(4);
  });

  it("leaves no temp file behind", async () => {
    await w.writeFrame(DEV);
    expect(fs.readdirSync(path.join(showDir(), "simulator", "SIM-1"))).toEqual(["frame.jpg"]);
  });

  it("takes the picture itself when no bytes are given", async () => {
    await w.writeFrame(DEV);
    expect(h.screenshot).toHaveBeenCalledWith(DEV);
  });

  it("uses the bytes it is given instead of asking the device", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toBuffer();
    await w.writeFrame(DEV, png);
    expect(h.screenshot).not.toHaveBeenCalled();
    expect((await sharp(fs.readFileSync(frameOf("SIM-1"))).metadata()).width).toBe(8);
  });
});

describe("watch", () => {
  it("writes the page and returns its file url", async () => {
    const url = await w.watch(DEV);
    const index = path.join(showDir(), "simulator", "SIM-1", "index.html");
    expect(url).toBe(pathToFileURL(index).href);
    expect(fs.existsSync(index)).toBe(true);
    expect(fs.readFileSync(index, "utf8")).toContain("<title>📱 iPhone 16 · iOS 18.2</title>");
  });

  it("writes the first frame, so the page shows something before the loop starts", async () => {
    await w.watch(DEV);
    expect(fs.existsSync(frameOf("SIM-1"))).toBe(true);
  });

  it("says the device is being watched", async () => {
    await w.watch(DEV);
    expect(w.watching("SIM-1")).toBe(true);
  });

  it("starts the clock again when the same device is watched twice", async () => {
    let now = 1000;
    await w.watch(DEV, () => now);
    now = 5000;
    await w.watch(DEV, () => now);
    // The page carries the later end time.
    const html = fs.readFileSync(path.join(showDir(), "simulator", "SIM-1", "index.html"), "utf8");
    expect(html).toContain(`const until=${5000 + w.WATCH_MS}`);
  });

  it("watches each device on its own", async () => {
    await w.watch(DEV);
    await w.watch(OTHER);
    expect(w.watching("SIM-1")).toBe(true);
    expect(w.watching("emulator-5554")).toBe(true);
  });
});

describe("the capture loop", () => {
  it("keeps writing frames a second apart", async () => {
    vi.useFakeTimers();
    await w.watch(DEV);
    expect(h.screenshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(w.FRAME_MS + 10);
    expect(h.screenshot.mock.calls.length).toBeGreaterThan(1);
    expect(fs.existsSync(frameOf("SIM-1"))).toBe(true);
  });

  it("stops at the end of the watch and forgets the device", async () => {
    vi.useFakeTimers();
    let now = 1000;
    await w.watch(DEV, () => now);
    now += w.WATCH_MS + 10;
    await vi.advanceTimersByTimeAsync(w.FRAME_MS * 3);
    expect(w.watching("SIM-1")).toBe(false);
  });

  it("keeps looping after a frame fails", async () => {
    vi.useFakeTimers();
    await w.watch(DEV);
    // The first frame is already written; the loop's own capture is the one that fails.
    h.screenshot.mockRejectedValueOnce(new Error("device asleep"));
    await vi.advanceTimersByTimeAsync(w.FRAME_MS * 3);
    expect(h.screenshot.mock.calls.length).toBeGreaterThan(2);
    expect(w.watching("SIM-1")).toBe(true);
  });

  it("stops writing frames once the watch is stopped", async () => {
    vi.useFakeTimers();
    await w.watch(DEV);
    w.stopWatching("SIM-1");
    await vi.advanceTimersByTimeAsync(w.FRAME_MS * 3);
    expect(h.screenshot).toHaveBeenCalledTimes(1);
  });

  it("stops quietly when the device is no longer the one being watched", async () => {
    vi.useFakeTimers();
    const renamed = { ...DEV };
    await w.watch(renamed);
    // The watch is keyed by the device's id, so a device that changes id is no longer watched.
    renamed.id = "SIM-2";
    await vi.advanceTimersByTimeAsync(w.FRAME_MS + 10);
    expect(h.screenshot).toHaveBeenCalledTimes(1);
  });

  it("does not restart the loop of a watch that has been replaced", async () => {
    vi.useFakeTimers();
    await w.watch(DEV);
    // The loop's next frame hangs, so it is still being written when the watch is replaced.
    let release!: (b: Buffer) => void;
    h.screenshot.mockReturnValueOnce(new Promise<Buffer>((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(w.FRAME_MS + 10);
    // Stopping and watching again makes a fresh watch for the same device, so the frame the
    // old loop was writing belongs to a watch that is no longer the current one.
    w.stopWatching("SIM-1");
    await w.watch(DEV);
    const before = h.screenshot.mock.calls.length;
    // The hanging frame finishes: the old loop must not schedule another one. Only the new
    // watch's own frame is captured, so the count grows by one, not two.
    release(Buffer.alloc(0));
    await vi.advanceTimersByTimeAsync(w.FRAME_MS * 2);
    expect(h.screenshot.mock.calls.length).toBe(before + 1);
    expect(w.watching("SIM-1")).toBe(true);
  });
});

describe("stopWatching", () => {
  it("stops one device by id and leaves the others", async () => {
    await w.watch(DEV);
    await w.watch(OTHER);
    w.stopWatching("SIM-1");
    expect(w.watching("SIM-1")).toBe(false);
    expect(w.watching("emulator-5554")).toBe(true);
  });

  it("stops every device when no id is given", async () => {
    await w.watch(DEV);
    await w.watch(OTHER);
    w.stopWatching();
    expect(w.watching("SIM-1")).toBe(false);
    expect(w.watching("emulator-5554")).toBe(false);
  });

  it("does nothing for a device that isn't watched", () => {
    expect(() => w.stopWatching("nope")).not.toThrow();
  });
});

describe("watching", () => {
  it("is false for a device nobody watches", () => {
    expect(w.watching("SIM-1")).toBe(false);
  });
});
