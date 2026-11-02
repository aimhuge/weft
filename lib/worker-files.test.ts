// The editor's files for a worker card (lib/worker-files.ts): each call a host verb run through askWorker, its value
// from the command's result or, when it was too big for the row, from /api/worker-board?blob=; a stale save as the
// editor's conflict, a big one refused before it goes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const askWorker = vi.hoisted(() => vi.fn());
vi.mock("./worker-acts", () => ({ askWorker }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());
vi.mock("./api-client", () => ({ apiFetch: (url: string) => fetchMock(url), API_HEADERS: {} }));

const { FileConflictError } = await import("./client-files");
const { LIST_TTL_MS, WRITE_MAX, askFiles, forgetLists, workerFiles } = await import("./worker-files");

const json = (body: unknown, ok = true) => new Response(JSON.stringify(body), { status: ok ? 200 : 502 });
const file = { path: "a.ts", exists: true, text: "x", hash: "h", mtime: 5, size: 1 };
const SHA = "ab".repeat(32);

// The worker answers `value` inline to whatever is asked next.
const answers = (value: unknown) => askWorker.mockResolvedValueOnce({ ok: true, cardId: "w1", value });

beforeEach(() => {
  vi.clearAllMocks();
  forgetLists();
});

describe("askFiles", () => {
  it("answers an inline value", async () => {
    answers({ files: ["a.ts"] });
    await expect(askFiles("files.list", { id: "w1" })).resolves.toEqual({ files: ["a.ts"] });
    expect(askWorker).toHaveBeenCalledWith("files.list", { id: "w1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a value that went to the blob store, and says why it can't", async () => {
    askWorker.mockResolvedValue({ ok: true, cardId: "w1", blob: SHA });
    fetchMock.mockResolvedValueOnce(json({ value: { file } }));
    await expect(askFiles("files.read", { id: "w1", path: "a.ts" })).resolves.toEqual({ file });
    expect(fetchMock).toHaveBeenCalledWith(`/api/worker-board?blob=${SHA}`);
    fetchMock.mockResolvedValueOnce(json({ error: "That result isn't in the blob store." }, false));
    await expect(askFiles("files.read", { id: "w1", path: "a.ts" })).rejects.toThrow("isn't in the blob store");
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 500 }));
    await expect(askFiles("files.read", { id: "w1", path: "a.ts" })).rejects.toThrow("HTTP 500");
    askWorker.mockReset();
  });

  it("passes the worker's refusal on", async () => {
    askWorker.mockRejectedValueOnce(new Error("a.ts is outside the card's folder."));
    await expect(askFiles("files.read", { id: "w1", path: "/x" })).rejects.toThrow("outside the card's folder");
  });
});

describe("workerFiles", () => {
  it("reads a file, its stat from a read, and its HEAD text", async () => {
    answers({ file });
    await expect(workerFiles.read("w1", "a.ts")).resolves.toEqual(file);
    answers({ file });
    await expect(workerFiles.stat("w1", "a.ts")).resolves.toEqual({ exists: true, mtime: 5, size: 1 });
    answers({ path: "a.ts", text: "old" });
    await expect(workerFiles.head("w1", "a.ts")).resolves.toBe("old");
    expect(askWorker).toHaveBeenLastCalledWith("files.read", { id: "w1", path: "a.ts", at: "HEAD" });
    expect(workerFiles.live).toBe(false);
  });

  it("lists a card's files once a minute, and asks again after a failure", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    answers({ files: ["a.ts"] });
    await expect(workerFiles.list("w1")).resolves.toEqual(["a.ts"]);
    await expect(workerFiles.list("w1")).resolves.toEqual(["a.ts"]);
    expect(askWorker).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000 + LIST_TTL_MS);
    askWorker.mockRejectedValueOnce(new Error("offline"));
    await expect(workerFiles.list("w1")).rejects.toThrow("offline");
    answers({ files: ["a.ts", "b.ts"] });
    await expect(workerFiles.list("w1")).resolves.toEqual(["a.ts", "b.ts"]);
    now.mockRestore();
  });

  it("saves, and a new file joins the index", async () => {
    answers({ files: ["a.ts"] });
    await workerFiles.list("w1");
    answers({ result: { hash: "h2", mtime: 9 } });
    await expect(workerFiles.write("w1", "b.ts", "y", null)).resolves.toEqual({ hash: "h2", mtime: 9 });
    expect(askWorker).toHaveBeenLastCalledWith("files.write", { id: "w1", path: "b.ts", text: "y", baseHash: null });
    answers({ files: ["a.ts", "b.ts"] });
    await expect(workerFiles.list("w1")).resolves.toEqual(["a.ts", "b.ts"]);
  });

  it("turns a stale save into the editor's conflict", async () => {
    answers({ conflict: file });
    const err = await workerFiles.write("w1", "a.ts", "y", "old").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileConflictError);
    expect((err as InstanceType<typeof FileConflictError>).current).toEqual(file);
  });

  it("refuses a file too big for the command before sending it", async () => {
    await expect(workerFiles.write("w1", "big.ts", "x".repeat(WRITE_MAX + 1))).rejects.toThrow("up to 150 KB");
    expect(askWorker).not.toHaveBeenCalled();
  });
});
