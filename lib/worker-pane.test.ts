import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notePage = vi.hoisted(() => vi.fn());
vi.mock("./card-page", () => ({ notePage }));
const tunnelFor = vi.hoisted(() => vi.fn<(url: string) => { address: string } | undefined>(() => undefined));
vi.mock("./tunnels", () => ({ tunnelFor }));
const { onWorker, openOnWorker, ownPageCall, sessionDirs, setPageUpload } = await import("./worker-pane");
const { SHOW_DIR } = await import("./show-dir");

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

describe("sessionDirs", () => {
  const worker = { WEFT_WORKER: "1" } as unknown as NodeJS.ProcessEnv;

  it("adds the show folder on a desktop card too", () => {
    expect(sessionDirs(undefined, {} as NodeJS.ProcessEnv)).toEqual([SHOW_DIR]);
    expect(sessionDirs(["/a"], {} as NodeJS.ProcessEnv)).toEqual(["/a", SHOW_DIR]);
  });

  it("adds the show folder on a worker, and nothing above it", () => {
    expect(sessionDirs(undefined, worker)).toEqual([SHOW_DIR]);
    expect(sessionDirs(["/a", SHOW_DIR], worker)).toEqual(["/a", SHOW_DIR]);
  });

  it("makes the folder first, because the CLI drops one that isn't there", () => {
    fs.rmSync(SHOW_DIR, { recursive: true, force: true });
    sessionDirs(undefined, worker);
    expect(fs.statSync(SHOW_DIR).isDirectory()).toBe(true);
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
    await expect(openOnWorker("c1", "http://localhost:3000")).rejects.toThrow(/mcp__webhooks__tunnel/);
    expect(notePage).not.toHaveBeenCalled();
  });

  it("trades a dev server's URL for its tunnel's private address", async () => {
    tunnelFor.mockReturnValue({ address: "https://weft.zip/t/t1" });
    expect(await openOnWorker("c1", "http://localhost:3000")).toContain("private address https://weft.zip/t/t1.");
    expect(notePage).toHaveBeenLastCalledWith("c1", "https://weft.zip/t/t1");
    await openOnWorker("c1", "http://localhost:3000/a/b?x=1#h");
    expect(notePage).toHaveBeenLastCalledWith("c1", "https://weft.zip/t/t1/a/b?x=1#h");
    expect(tunnelFor).toHaveBeenCalledWith("http://localhost:3000/a/b?x=1#h");
    tunnelFor.mockReturnValue(undefined);
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
