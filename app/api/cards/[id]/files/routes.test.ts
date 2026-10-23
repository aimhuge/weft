// app/api/cards/[id]/files/route.ts: GET reads, stats, heads and lists; PUT writes with a
// baseHash conflict check. The lib is mocked, the store has a single card with a real
// temp cwd, and the route is called with a Request.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const { FileAccessError } = vi.hoisted(() => ({
  FileAccessError: class FileAccessError extends Error {
    constructor(message: string, readonly code: "outside" | "git" | "secret" | "binary" | "missing") {
      super(message);
      this.name = "FileAccessError";
    }
  },
}));

const fileAccess = vi.hoisted(() => ({
  FileAccessError,
  readFile: vi.fn(),
  statFile: vi.fn(),
  headOf: vi.fn(),
  listFiles: vi.fn(),
  writeFile: vi.fn(),
}));

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), seq: 0 }));

// The guard reads the launch token; none here, so every check no-ops.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("@/lib/store", () => ({
  getCard: vi.fn((id: string) => db.cards.get(id)),
}));

vi.mock("@/lib/file-access", () => fileAccess);

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const READ = { host: "localhost:3457" };
const body = async <T>(res: Response): Promise<T> => (await res.json()) as T;

function req(url: string, { method = "GET", body, headers = READ }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "weft-files-route-"));
const card: Card = {
  id: "c1",
  title: "T",
  prompt: "p",
  cwd,
  backend: "claude",
  permissionMode: "auto",
  column: "backlog",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  db.cards.clear();
  db.cards.set(card.id, card);
  vi.clearAllMocks();
});

async function load() {
  vi.resetModules();
  return import("./route");
}

const OP = {
  read: () => fileAccess.readFile.mockResolvedValue({ path: "a.txt", exists: true, text: "hi", hash: "h", mtime: 1, size: 2 }),
  stat: () => fileAccess.statFile.mockResolvedValue({ path: "a.txt", exists: true, mtime: 1, size: 2 }),
  head: () => fileAccess.headOf.mockResolvedValue({ path: "a.txt", text: "head" }),
  list: () => fileAccess.listFiles.mockResolvedValue(["a.txt", "b.txt"]),
  write: (result: object) => fileAccess.writeFile.mockResolvedValue(result),
};

describe("GET /api/cards/:id/files", () => {
  it("reads with ?path=", async () => {
    OP.read();
    const { GET } = await load();
    const res = await GET(req(`/cards/c1/files?path=a.txt`), ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ file: { path: "a.txt", exists: true, text: "hi", hash: "h", mtime: 1, size: 2 } });
    expect(fileAccess.readFile).toHaveBeenCalledWith(cwd, "a.txt");
  });

  it("stats with ?path=&op=stat", async () => {
    OP.stat();
    const { GET } = await load();
    const res = await GET(req(`/cards/c1/files?path=a.txt&op=stat`), ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stat: { path: "a.txt", exists: true, mtime: 1, size: 2 } });
    expect(fileAccess.statFile).toHaveBeenCalledWith(cwd, "a.txt");
  });

  it("returns the git HEAD version with ?op=head", async () => {
    OP.head();
    const { GET } = await load();
    const res = await GET(req(`/cards/c1/files?path=a.txt&op=head`), ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "a.txt", text: "head" });
    expect(fileAccess.headOf).toHaveBeenCalledWith(cwd, "a.txt");
  });

  it("returns null for an untracked HEAD", async () => {
    fileAccess.headOf.mockResolvedValue({ path: "a.txt", text: null });
    const { GET } = await load();
    const res = await GET(req(`/cards/c1/files?path=a.txt&op=head`), ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "a.txt", text: null });
  });

  it("lists with ?op=list and refuses a path", async () => {
    OP.list();
    const { GET } = await load();
    const ok = await GET(req(`/cards/c1/files?op=list`), ctx("c1"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ files: ["a.txt", "b.txt"] });
    expect(fileAccess.listFiles).toHaveBeenCalledWith(cwd);

    const { GET: GET2 } = await load();
    const bad = await GET2(req(`/cards/c1/files?op=list&path=a.txt`), ctx("c1"));
    expect(bad.status).toBe(400);
  });

  it("400s an unknown op or a missing path", async () => {
    const { GET } = await load();
    const op = await GET(req(`/cards/c1/files?path=a.txt&op=wat`), ctx("c1"));
    expect(op.status).toBe(400);
    const noPath = await GET(req(`/cards/c1/files`), ctx("c1"));
    expect(noPath.status).toBe(400);
    const noPath2 = await GET(req(`/cards/c1/files?op=stat`), ctx("c1"));
    expect(noPath2.status).toBe(400);
  });

  it("404s a missing card and 400s a file-access error", async () => {
    const { GET } = await load();
    const ghost = await GET(req(`/cards/ghost/files?path=a.txt`), ctx("ghost"));
    expect(ghost.status).toBe(404);

    fileAccess.readFile.mockRejectedValueOnce(new FileAccessError("nope", "outside"));
    const refused = await GET(req(`/cards/c1/files?path=a.txt`), ctx("c1"));
    expect(refused.status).toBe(400);
    expect((await body<{ error: string }>(refused)).error).toMatch(/nope/);
  });

  it("rejects a foreign host without x-weft-token (read route)", async () => {
    const { GET } = await load();
    const res = await GET(req(`/cards/c1/files?path=a.txt`, { headers: { host: "evil.com" } }), ctx("c1"));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/cards/:id/files", () => {
  it("writes a file and returns the new hash and mtime", async () => {
    OP.write({ result: { hash: "h2", mtime: 2 } });
    const { PUT } = await load();
    const res = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: WRITE, body: { path: "a.txt", text: "new", baseHash: "h" } }), ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { hash: "h2", mtime: 2 } });
    expect(fileAccess.writeFile).toHaveBeenCalledWith(cwd, "a.txt", "new", "h");
  });

  it("passes baseHash: null through (a save that expects the file to not exist)", async () => {
    OP.write({ result: { hash: "h", mtime: 1 } });
    const { PUT } = await load();
    const res = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: WRITE, body: { path: "new.txt", text: "x", baseHash: null } }), ctx("c1"));
    expect(res.status).toBe(200);
    expect(fileAccess.writeFile).toHaveBeenCalledWith(cwd, "new.txt", "x", null);
  });

  it("returns 409 with the current file on a baseHash conflict", async () => {
    fileAccess.writeFile.mockResolvedValueOnce({ conflict: { path: "a.txt", exists: true, text: "stale", hash: "h3", mtime: 5, size: 5 } });
    const { PUT } = await load();
    const res = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: WRITE, body: { path: "a.txt", text: "x", baseHash: "h" } }), ctx("c1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "File changed on disk.", current: { path: "a.txt", exists: true, text: "stale", hash: "h3", mtime: 5, size: 5 } });
  });

  it("400s a missing card, bad JSON, missing path/text, or a bad baseHash", async () => {
    const { PUT } = await load();
    db.cards.delete("c1");
    const ghost = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: WRITE, body: { path: "a.txt", text: "x" } }), ctx("c1"));
    expect(ghost.status).toBe(404);
    db.cards.set(card.id, card);

    for (const body of ["{", {}, { path: "a.txt" }, { text: "x" }, { path: 1, text: "x" }, { path: "a.txt", text: 1 }, { path: "a.txt", text: "x", baseHash: 5 }]) {
      const res = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: WRITE, body }), ctx("c1"));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(fileAccess.writeFile).not.toHaveBeenCalled();
  });

  it("400s a file-access error from the lib", async () => {
    fileAccess.writeFile.mockRejectedValueOnce(new FileAccessError("binary", "binary"));
    const { PUT } = await load();
    const res = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: WRITE, body: { path: "a.txt", text: "x" } }), ctx("c1"));
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toMatch(/binary/);
  });

  it("rejects a foreign host and a missing x-weft-token", async () => {
    const { PUT } = await load();
    const foreign = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: { host: "evil.com", "x-weft-token": "1" }, body: { path: "a.txt", text: "x" } }), ctx("c1"));
    expect(foreign.status).toBe(403);
    const noHeader = await PUT(req(`/cards/c1/files`, { method: "PUT", headers: { host: "localhost:3457" }, body: { path: "a.txt", text: "x" } }), ctx("c1"));
    expect(noHeader.status).toBe(403);
    expect(fileAccess.writeFile).not.toHaveBeenCalled();
  });
});