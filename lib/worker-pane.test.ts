import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notePage = vi.hoisted(() => vi.fn());
vi.mock("./card-page", () => ({ notePage }));
const { onWorker, openOnWorker, setPageUpload } = await import("./worker-pane");

fs.mkdirSync(os.homedir(), { recursive: true });
const home = fs.mkdtempSync(path.join(os.homedir(), "worker-pane-test-"));
const page = path.join(home, "plan.html");
fs.writeFileSync(page, "<html><head><title> The plan </title></head></html>");
const REF = `blob:sha256:${"a".repeat(64)}` as const;
const upload = vi.fn(() => Promise.resolve<typeof REF | null>(REF));

beforeEach(() => {
  vi.clearAllMocks();
  setPageUpload(upload);
});
afterEach(() => setPageUpload(null));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("onWorker", () => {
  it("reads the flag scripts/weft-worker.ts sets", () => {
    expect(onWorker({ WEFT_WORKER: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(onWorker({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("openOnWorker", () => {
  it("uploads a page before it answers, and notes it on the card", async () => {
    const said = await openOnWorker("c1", `file://${page}#step-2`);
    expect(upload).toHaveBeenCalledWith(page);
    expect(notePage).toHaveBeenCalledWith("c1", `file://${page}#step-2`);
    expect(said).toContain("The plan");
    expect(said).toContain("in the pane");
  });

  it("takes a bare absolute path, and a page with no title", async () => {
    const plain = path.join(home, "plain.html");
    fs.writeFileSync(plain, "<p>hi</p>");
    expect(await openOnWorker("c1", ` ${plain} `)).toContain("— page.");
  });

  it("opens a public site with no upload", async () => {
    expect(await openOnWorker("c1", "https://example.com/a")).toBe("Opened https://example.com/a");
    expect(upload).not.toHaveBeenCalled();
    expect(notePage).toHaveBeenCalledWith("c1", "https://example.com/a");
  });

  it("refuses a dev server and says why", async () => {
    await expect(openOnWorker("c1", "http://localhost:3000")).rejects.toThrow(/dev server/);
    expect(notePage).not.toHaveBeenCalled();
  });

  it("refuses a relative or missing path", async () => {
    await expect(openOnWorker("c1", "plan.html")).rejects.toThrow(/Can't show/);
    await expect(openOnWorker("c1", path.join(home, "gone.html"))).rejects.toThrow(/Can't show/);
  });

  it("refuses what the worker's rule vetoes, and notes nothing", async () => {
    upload.mockResolvedValueOnce(null);
    await expect(openOnWorker("c1", page)).rejects.toThrow(/Can't show/);
    expect(notePage).not.toHaveBeenCalled();
  });

  it("passes a failed upload to the agent", async () => {
    upload.mockRejectedValueOnce(new Error("That key isn't a worker's."));
    await expect(openOnWorker("c1", page)).rejects.toThrow("That key isn't a worker's.");
  });

  it("says to update a build with no uploader", async () => {
    setPageUpload(null);
    await expect(openOnWorker("c1", page)).rejects.toThrow(/weft-worker update/);
  });
});
