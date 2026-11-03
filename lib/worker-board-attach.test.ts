// Files pasted into a worker card's message (lib/worker-board.ts withAttachments, lib/attachment-transfer.ts): a reply
// and a new thread upload what they paste from this Mac's attachments folder and list it on the row.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, workerRow } from "./worker-board.harness";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("org-1") }));

const { sendWorkerAction } = await import("./worker-board");
const { startWorkerThread } = await import("./worker-new-thread");

const NOW = Date.parse("2026-10-29T10:00:00.000Z");
const PNG = Buffer.from("a screenshot");
const SHA = createHash("sha256").update(PNG).digest("hex");
const target = { owner_device: "worker:w1", owner_worker: "w1", folder: "ling", owner_user: "u-1" };

let dir: string;
beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "attach-")), "attachments");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "shot-1a2b.png"), PNG);
});
afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

const text = (d: string) => `what's wrong here? ![shot](${path.join(d, "shot-1a2b.png")})`;

describe("a message to a worker with a pasted file", () => {
  it("uploads the file and lists it on the reply", async () => {
    const { client, inserted, uploads } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "reply", cardId: "c1", text: text(dir) }, client, dir);
    expect(uploads).toMatchObject([{ path: `org-1/${SHA}`, type: "image/png" }]);
    expect(inserted()).toMatchObject({ kind: "reply", payload: { cardId: "c1", text: text(dir), attachments: [{ name: "shot-1a2b.png", sha: SHA, mime: "image/png" }] } });
  });

  it("does the same for a new thread", async () => {
    const { client, inserted } = fakeClient({ workers: [workerRow({ last_seen_at: new Date(NOW).toISOString() })] });
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: text(dir) }, client, NOW, dir);
    expect(inserted()).toMatchObject({ kind: "host", payload: { verb: "card.create", args: { prompt: text(dir) }, attachments: [{ name: "shot-1a2b.png", sha: SHA }] } });
  });

  it("does the same for a host verb's typed text, and leaves a verb with none alone", async () => {
    const { client, inserted, uploads } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "host", cardId: "c1", verb: "card.message.edit", args: { text: text(dir) } }, client, dir);
    expect(inserted()).toMatchObject({ kind: "host", payload: { verb: "card.message.edit", args: { id: "c1", text: text(dir) }, attachments: [{ name: "shot-1a2b.png", sha: SHA }] } });
    await sendWorkerAction({ action: "host", cardId: "c1", verb: "card.fresh", args: { message: 3 } }, client, dir);
    await sendWorkerAction({ action: "host", cardId: "c1", verb: "card.stop" }, client, dir);
    expect(uploads).toHaveLength(1);
    expect((inserted() as { payload: object }).payload).toEqual({ verb: "card.stop", args: { id: "c1" } });
  });

  it("leaves a text reply's row as it was", async () => {
    const { client, inserted, uploads } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "reply", cardId: "c1", text: "no files" }, client, dir);
    expect(uploads).toEqual([]);
    expect((inserted() as { payload: object }).payload).toEqual({ cardId: "c1", text: "no files" });
  });

  it("sends nothing when the upload fails", async () => {
    const { client, inserted } = fakeClient({ cardRow: target, uploadError: { message: "bucket down" } });
    await expect(sendWorkerAction({ action: "reply", cardId: "c1", text: text(dir) }, client, dir)).rejects.toThrow("bucket down");
    expect(inserted()).toBeNull();
  });

  it("sends nothing when the file goes before it uploads", async () => {
    const { client, inserted } = fakeClient({ cardRow: target });
    const gone = path.join(dir, "shot-1a2b.png");
    const real = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => p !== gone && real(p));
    await expect(sendWorkerAction({ action: "reply", cardId: "c1", text: text(dir) }, client, dir)).rejects.toThrow("Couldn't upload shot-1a2b.png");
    expect(inserted()).toBeNull();
    vi.restoreAllMocks();
  });
});
