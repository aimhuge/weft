import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notePage = vi.hoisted(() => vi.fn());
vi.mock("./card-page", () => ({ notePage }));
// The worker's browser open_url reaches when no test hands in its own.
const workerShell = vi.hoisted(() => vi.fn(() => Promise.resolve({ url: "https://example.com/", title: "Example" })));
vi.mock("./worker-browser-routes", () => ({ workerShell }));
const tunnelFor = vi.hoisted(() => vi.fn<(url: string) => { address: string } | undefined>(() => undefined));
vi.mock("./tunnels", () => ({ tunnelFor }));
const { onWorker, openOnWorker, ownPageCall, setPageUpload } = await import("./worker-pane");
const { SHOW_DIR } = await import("./show-dir");

fs.mkdirSync(os.homedir(), { recursive: true });
const home = fs.mkdtempSync(path.join(os.homedir(), "worker-pane-test-"));
const page = path.join(home, "plan.html");
fs.writeFileSync(page, "<html><head><title> The plan </title></head></html>");
const REF = `blob:sha256:${"a".repeat(64)}` as const;
const upload = vi.fn(() => Promise.resolve<typeof REF | null>(REF));
const browse = vi.fn(() => Promise.resolve({ url: "", title: "" }));

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

describe("ownPageCall", () => {
  const worker = { WEFT_WORKER: "1" } as unknown as NodeJS.ProcessEnv;
  const auto = { cwd: home, permissionMode: "auto" as const };
  const inShow = (name: string) => ({ file_path: path.join(SHOW_DIR, name) });

  beforeEach(() => fs.mkdirSync(SHOW_DIR, { recursive: true }));

  it("lets a page through in Accept edits and in Auto, the mode the prompt was seen in", () => {
    expect(ownPageCall("Edit", inShow("a.html"), auto, worker)).toBe(true);
    expect(ownPageCall("Write", inShow("new/a.html"), { ...auto, permissionMode: "acceptEdits" }, worker)).toBe(true);
    expect(ownPageCall("Read", inShow("a.html"), auto, worker)).toBe(true);
  });

  it("still asks on a Mac, and in Ask me, the mode you picked to be asked in", () => {
    expect(ownPageCall("Edit", inShow("a.html"), auto, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(ownPageCall("Edit", inShow("a.html"), { ...auto, permissionMode: "default" }, worker)).toBe(false);
  });

  it("opens nothing past the folder: not its parent, a neighbour, Bash or a call with no path", () => {
    expect(ownPageCall("Edit", inShow("../board.json"), auto, worker)).toBe(false);
    expect(ownPageCall("Edit", { file_path: `${SHOW_DIR}case/a.html` }, auto, worker)).toBe(false);
    expect(ownPageCall("Bash", { command: `rm ${SHOW_DIR}/a.html` }, auto, worker)).toBe(false);
    expect(ownPageCall("Edit", {}, auto, worker)).toBe(false);
  });

  it("goes by where a link lands, not where it sits", () => {
    const link = path.join(SHOW_DIR, "out");
    fs.rmSync(link, { force: true });
    fs.symlinkSync(home, link);
    expect(ownPageCall("Edit", inShow("out/plan.html"), auto, worker)).toBe(false);
    fs.rmSync(link);
  });
});

describe("openOnWorker", () => {
  it("uploads a page before it answers, and notes it on the card", async () => {
    const said = await openOnWorker("c1", `file://${page}#step-2`, browse);
    expect(upload).toHaveBeenCalledWith(page);
    expect(notePage).toHaveBeenCalledWith("c1", `file://${page}#step-2`);
    expect(said).toContain("The plan");
    expect(said).toContain("in the pane");
  });

  it("takes a bare absolute path, and a page with no title", async () => {
    const plain = path.join(home, "plain.html");
    fs.writeFileSync(plain, "<p>hi</p>");
    expect(await openOnWorker("c1", ` ${plain} `, browse)).toContain("— page.");
  });

  it("opens a public site in the worker's browser, live, with no upload", async () => {
    const browse = vi.fn(() => Promise.resolve({ url: "https://example.com/a", title: "Example" }));
    expect(await openOnWorker("c1", "https://example.com/a", browse)).toBe("Opened https://example.com/a — Example. It's live in the pane on the user's board, from this worker's browser.");
    expect(browse).toHaveBeenCalledWith("c1", "https://example.com/a");
    expect(upload).not.toHaveBeenCalled();
  });

  it("opens through the worker's browser routes by default", async () => {
    expect(await openOnWorker("c1", "https://example.com")).toContain("— Example.");
    expect(workerShell).toHaveBeenCalledWith("/browser/open", { key: "c1", url: "https://example.com" });
  });

  it("still shows a public site as itself when the browser can't start", async () => {
    const browse = vi.fn(() => Promise.reject(new Error("no Chromium")));
    expect(await openOnWorker("c1", "https://example.com/a", browse)).toBe("Opened https://example.com/a");
    expect(notePage).toHaveBeenCalledWith("c1", "https://example.com/a");
  });

  it("opens this box's dev server in its browser, or says why it can't", async () => {
    const browse = vi.fn(() => Promise.resolve({ url: "http://localhost:3000/", title: "" }));
    expect(await openOnWorker(undefined, "http://localhost:3000", browse)).toContain("Opened http://localhost:3000/ — page. It's live");
    expect(browse).toHaveBeenCalledWith("", "http://localhost:3000");
    await expect(openOnWorker("c1", "http://localhost:3000", () => Promise.reject(new Error("no Chromium")))).rejects.toThrow(/mcp__webhooks__tunnel.*no Chromium/);
    expect(notePage).not.toHaveBeenCalled();
  });

  it("trades a dev server's URL for its tunnel's private address", async () => {
    const browse = vi.fn();
    tunnelFor.mockReturnValue({ address: "https://weft.zip/t/t1" });
    expect(await openOnWorker("c1", "http://localhost:3000", browse)).toContain("private address https://weft.zip/t/t1.");
    expect(notePage).toHaveBeenLastCalledWith("c1", "https://weft.zip/t/t1");
    await openOnWorker("c1", "http://localhost:3000/a/b?x=1#h", browse);
    expect(notePage).toHaveBeenLastCalledWith("c1", "https://weft.zip/t/t1/a/b?x=1#h");
    expect(tunnelFor).toHaveBeenCalledWith("http://localhost:3000/a/b?x=1#h");
    expect(browse).not.toHaveBeenCalled();
    tunnelFor.mockReturnValue(undefined);
  });

  it("opens an uploaded page in the worker's browser too, and doesn't mind when it can't", async () => {
    const browse = vi.fn(() => Promise.reject(new Error("no Chromium")));
    expect(await openOnWorker(undefined, page, browse)).toContain("The plan");
    expect(browse).toHaveBeenCalledWith("", page);
  });

  it("refuses a relative or missing path", async () => {
    await expect(openOnWorker("c1", "plan.html", browse)).rejects.toThrow(/Can't show/);
    await expect(openOnWorker("c1", path.join(home, "gone.html"), browse)).rejects.toThrow(/Can't show/);
  });

  it("refuses what the worker's rule vetoes, and notes nothing", async () => {
    upload.mockResolvedValueOnce(null);
    await expect(openOnWorker("c1", page, browse)).rejects.toThrow(/Can't show/);
    expect(notePage).not.toHaveBeenCalled();
  });

  it("passes a failed upload to the agent", async () => {
    upload.mockRejectedValueOnce(new Error("That key isn't a worker's."));
    await expect(openOnWorker("c1", page, browse)).rejects.toThrow("That key isn't a worker's.");
  });

  it("says to update a build with no uploader", async () => {
    setPageUpload(null);
    await expect(openOnWorker("c1", page, browse)).rejects.toThrow(/weft-worker update/);
  });
});
