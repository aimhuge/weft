import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";

vi.mock("next/server", () => ({ connection: async () => {} }));

// A shared list so setSyncFolder mutates what syncFolders reads back.
const shared = vi.hoisted(() => {
  const folders: string[] = [];
  return {
    folders,
    setSyncFolderMock: vi.fn((folder: string, on: boolean) => {
      const rest = folders.filter((f) => f !== folder);
      folders.length = 0;
      folders.push(...(on ? [...rest, folder] : rest));
    }),
  };
});

const setSyncFolder = shared.setSyncFolderMock;
const syncFolders = vi.fn(() => [...shared.folders]);
const status: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const cloudSyncStatus = vi.fn(() => ({ ...status }));
const syncNow = vi.fn();
const queueFolder = vi.fn();

vi.mock("@/lib/settings", () => ({ syncFolders, setSyncFolder }));
vi.mock("@/lib/cloud-sync", () => ({ cloudSyncStatus, syncNow, queueFolder }));
const rememberSyncRepo = vi.fn<(folder: string, on: boolean) => Promise<void>>(() => Promise.resolve());
vi.mock("@/lib/cloud-sync-repos", () => ({ rememberSyncRepo }));

const route = await import("./cloud-sync/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const READ = { host: "localhost:3457" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const body = (res: Response) => res.json() as Promise<unknown>;

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-api-cloud-sync-")));
  shared.folders.length = 0;
  vi.clearAllMocks();
});

describe("GET /api/cloud-sync", () => {
  it("returns folders and status without requiring x-weft-token (read)", async () => {
    const res = await route.GET(req("/cloud-sync", { headers: READ }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      folders: [],
      status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
    });
  });

  it("returns 403 for a foreign host on a read", async () => {
    const res = await route.GET(req("/cloud-sync", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: "Forbidden host" });
  });
});

describe("POST /api/cloud-sync", () => {
  it("rejects a foreign host", async () => {
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { sync: true }, headers: { host: "evil.com", "x-weft-token": "1" } }));
    expect(res.status).toBe(403);
    expect(setSyncFolder).not.toHaveBeenCalled();
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("rejects a write without x-weft-token", async () => {
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { sync: true }, headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(403);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("sync=true calls syncNow and returns the current status", async () => {
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { sync: true } }));
    expect(res.status).toBe(200);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(setSyncFolder).not.toHaveBeenCalled();
    expect(queueFolder).not.toHaveBeenCalled();
    expect(await body(res)).toEqual({
      status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
    });
  });

  it("turning a folder on resolves it, saves it, and queues its existing cards", async () => {
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { folder: tmp, on: true } }));
    expect(res.status).toBe(200);
    expect(setSyncFolder).toHaveBeenCalledWith(tmp, true);
    expect(queueFolder).toHaveBeenCalledWith(tmp);
    expect(syncNow).not.toHaveBeenCalled();
    expect(await body(res)).toEqual({
      folder: tmp,
      on: true,
      folders: [tmp],
      status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
    });
  });

  it("turning a folder off saves it but does not queue its cards", async () => {
    shared.folders.push(tmp);
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { folder: tmp, on: false } }));
    expect(res.status).toBe(200);
    expect(setSyncFolder).toHaveBeenCalledWith(tmp, false);
    expect(queueFolder).not.toHaveBeenCalled();
    expect(await body(res)).toMatchObject({ folders: [] });
    expect(rememberSyncRepo).toHaveBeenCalledWith(tmp, false);
  });

  it("records the switch for the folder's repo, and a failure there doesn't fail the answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rememberSyncRepo.mockRejectedValueOnce(new Error("no table"));
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { folder: tmp, on: true } }));
    expect(res.status).toBe(200);
    expect(rememberSyncRepo).toHaveBeenCalledWith(tmp, true);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("[weft] project sync across Macs:", expect.any(Error)));
    warn.mockRestore();
  });

  it("on missing defaults to true", async () => {
    await route.POST(req("/cloud-sync", { method: "POST", body: { folder: tmp } }));
    expect(setSyncFolder).toHaveBeenCalledWith(tmp, true);
    expect(queueFolder).toHaveBeenCalledWith(tmp);
  });

  it("returns 400 when the folder isn't a real folder", async () => {
    const missing = path.join(tmp, "nope");
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: { folder: missing } }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: `${missing} isn't a folder.` });
    expect(setSyncFolder).not.toHaveBeenCalled();
  });

  it("returns 400 when neither folder nor sync is provided", async () => {
    const res = await route.POST(req("/cloud-sync", { method: "POST", body: {} }));
    expect(res.status).toBe(400);
    expect(setSyncFolder).not.toHaveBeenCalled();
    expect(syncNow).not.toHaveBeenCalled();
  });
});
