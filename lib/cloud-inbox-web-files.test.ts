// What weft.zip's full New thread form and pasted files ask of this Mac (lib/cloud-inbox-cards.ts, lib/cloud-inbox-receive.ts):
// a card made in Backlog and left there, a looser mode held to the phone's rule, and a file pasted on the web brought
// down through the account's session into this Mac's attachments folder before the text reaches the card.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, control, db, listening, reports, resetInbox } from "./cloud-inbox.harness";
import type { CloudCommandRow } from "./cloud-commands";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-web-files-"));
vi.mock("./account", async () => (await import("./cloud-inbox.harness")).accountMock);
vi.mock("./settings", async () => (await import("./cloud-inbox.harness")).settingsMock);
vi.mock("./device-id", async () => (await import("./cloud-inbox.harness")).deviceMock);
vi.mock("./desktop-worker", async () => (await import("./cloud-inbox.harness")).desktopWorkerMock);
vi.mock("./device-calls", async () => (await import("./cloud-inbox.harness")).deviceCallsMock);
vi.mock("./cloud-sync", async () => (await import("./cloud-inbox.harness")).cloudSyncMock);
vi.mock("./new-card", async () => (await import("./cloud-inbox.harness")).newCardMock);
vi.mock("./runner", async () => (await import("./cloud-inbox.harness")).runnerMock);
vi.mock("./host-api", async (real) => (await import("./cloud-inbox.harness")).hostApiMock(real));
vi.mock("./store", async () => ({ ...(await import("./cloud-inbox.harness")).storeMock, DATA_DIR: dataDir }));
const blobs = vi.hoisted(() => new Map<string, Uint8Array>());
const readBlob = vi.hoisted(() => vi.fn((_client: unknown, org: string, sha: string) => Promise.resolve(blobs.has(`${org}/${sha}`) ? { bytes: blobs.get(`${org}/${sha}`)!.buffer, type: "image/png", from: "supabase" } : null)));
vi.mock("./blob-read", () => ({ readBlob }));
const shellMock = vi.hoisted(() => vi.fn((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true })));
vi.mock("./browser-shell", () => ({ shell: shellMock }));

const { refreshCloudInbox } = await import("./cloud-inbox");
const { macReceive } = await import("./cloud-inbox-receive");

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const SHA = createHash("sha256").update(PNG).digest("hex");
const NAME = `shot-${SHA.slice(0, 8)}.png`;
const pasted = `look ![shot](/attachments/${NAME})`;
const attachments = [{ name: NAME, sha: SHA, mime: "image/png" }];

const run = (row: CloudCommandRow) => {
  db.updates.length = 0;
  db.pending = [row];
  return listening(refreshCloudInbox);
};

beforeEach(() => {
  resetInbox();
  blobs.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  control.startCard.mockClear();
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
});

afterEach(() => {
  shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true }));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a new card from weft.zip's form", () => {
  it("is made in Backlog and left there when it asks", async () => {
    await run(command({ payload: { prompt: "Later", start: false, tags: ["ui"] } as never }));
    expect(control.made).toEqual([expect.objectContaining({ prompt: "Later", start: false, tags: ["ui"] })]);
    expect(control.startCard).not.toHaveBeenCalled();
    expect(control.syncNow).toHaveBeenCalled();
    expect(reports()).toEqual([{ status: "done", card_id: "card-1" }]);
  });

  it("hands a card with no prompt on as it is, for the card maker to refuse", async () => {
    await run(command({ payload: { start: false } as never }));
    expect(control.made.at(-1)).toMatchObject({ prompt: undefined, start: false });
  });

  it("starts in plan mode, and in a looser one only while the web may approve", async () => {
    await run(command({ payload: { prompt: "Plan", permissionMode: "plan" } as never }));
    expect(control.made.at(-1)).toMatchObject({ permissionMode: "plan" });
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 1, webApprovals: false } : { ok: true }));
    await run(command({ id: "cmd-2", payload: { prompt: "Go", permissionMode: "auto" } as never }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/phone is paired/) as string });
    expect(control.made).toHaveLength(1);
  });

  it("brings a pasted file over before the card starts, and points its prompt at the copy", async () => {
    blobs.set(`org1/${SHA}`, PNG);
    await run(command({ payload: { prompt: pasted, attachments } as never }));
    const saved = path.join(dataDir, "attachments", NAME);
    expect(fs.readFileSync(saved)).toEqual(Buffer.from(PNG));
    expect(control.made.at(-1)?.prompt).toBe(`look ![shot](${saved})`);
  });
});

describe("a reply from weft.zip with a pasted file", () => {
  it("reaches the card pointing at this Mac's copy", async () => {
    blobs.set(`org1/${SHA}`, PNG);
    await run(command({ kind: "reply", payload: { cardId: "card-7", text: pasted, attachments } as never }));
    expect(control.sendUserMessage).toHaveBeenCalledWith("card-7", `look ![shot](${path.join(dataDir, "attachments", NAME)})`);
  });

  it("fails, with a reason, when the file isn't in the workspace's blobs", async () => {
    await run(command({ kind: "reply", payload: { cardId: "card-7", text: pasted, attachments } as never }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: `Couldn't bring ${NAME} over from the Mac it was pasted on.` });
  });
});

describe("macReceive", () => {
  it("leaves a text that lists no files as it is, and needs a workspace for one that does", async () => {
    const receive = macReceive({} as never, "u1", { dir: () => dataDir, read: readBlob as never });
    await expect(receive("plain", {})).resolves.toBe("plain");
    control.org = null;
    await expect(receive(pasted, { attachments })).rejects.toThrow("doesn't sync to a workspace");
  });
});
