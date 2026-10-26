import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudResult } from "@/lib/site-notes-cloud";
import type { SendDeps, SendResult } from "@/lib/site-notes-send";
import type { UploadResult } from "@/lib/site-notes-remote";
import type { OutboxItem } from "@/lib/site-notes-store";
import type { ServedVersion } from "@/lib/site-notes-status";
import type { WebUser } from "@/lib/web-session";

// The two site-notes routes: the board's own consent surface (/api/site-notes) and weft.zip's shared
// notes (/api/site-notes/cloud).

vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("next/server", () => ({ connection: async () => {} }));

// --- the board's route ---

const listOutbox = vi.fn(() => [] as Array<{ id: string }>);
const publicSharingOn = vi.fn(() => false);
const queueOutbox = vi.fn();
const setPublicSharing = vi.fn();
const takeOutbox = vi.fn(() => [] as Array<{ id: string }>);
vi.mock("@/lib/site-notes-store", () => ({ listOutbox, publicSharingOn, queueOutbox, setPublicSharing, takeOutbox }));

const uploadRemote = vi.fn<(upload: { host: string; path: string; body: string; scope: "team" | "public" }, deps: unknown) => Promise<UploadResult>>(() => Promise.resolve({ ok: true, versionId: "v1" }));
vi.mock("@/lib/site-notes-remote", () => ({ uploadRemote }));

const sendOutbox = vi.fn<(ids: string[] | undefined, deps: SendDeps) => Promise<SendResult[]>>(() => Promise.resolve([]));
vi.mock("@/lib/site-notes-send", () => ({ sendOutbox }));

const remoteDeps = { token: () => Promise.resolve("tok"), fetchFn: () => Promise.resolve(new Response("{}")), env: {} };
vi.mock("@/lib/site-notes-live", () => ({ remoteDeps }));

const board = await import("./site-notes/route");

// --- the cloud route ---

const bearerUser = vi.fn<(req: Request) => Promise<WebUser | null>>(() => Promise.resolve({ id: "u1", email: null, name: null, avatar: null }));
const serviceClient = vi.fn<() => { kind: string } | null>(() => ({ kind: "service" }));
vi.mock("@/lib/web-session", () => ({ bearerUser, serviceClient }));

const notesForHost = vi.fn<() => Promise<CloudResult<ServedVersion[]>>>(() => Promise.resolve({ ok: true, value: [] }));
const reportOutcome = vi.fn<() => Promise<CloudResult<null>>>(() => Promise.resolve({ ok: true, value: null }));
const uploadNote = vi.fn<() => Promise<CloudResult<{ versionId: string; findings: unknown[] }>>>(() => Promise.resolve({ ok: true, value: { versionId: "v1", findings: [] } }));
vi.mock("@/lib/site-notes-cloud", () => ({ notesForHost, reportOutcome, uploadNote }));

const supabaseNotesDb = vi.fn((client: unknown) => client);
vi.mock("@/lib/site-notes-db", () => ({ supabaseNotesDb }));

const cloud = await import("./site-notes/cloud/route");

const READ = { host: "localhost:3457", "x-weft-token": "1" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

const get = (url = "http://localhost:3457/api/site-notes", headers: Record<string, string> = READ) => board.GET(new Request(url, { headers }));
const put = (body: unknown, headers: Record<string, string> = WRITE) => board.PUT(new Request("http://localhost:3457/api/site-notes", { method: "PUT", headers, body: JSON.stringify(body) }));
const post = (body: unknown, headers: Record<string, string> = WRITE) => board.POST(new Request("http://localhost:3457/api/site-notes", { method: "POST", headers, body: JSON.stringify(body) }));

const cloudGet = (url = "http://localhost:3457/api/site-notes/cloud?host=example.com", headers: Record<string, string> = {}) => cloud.GET(new Request(url, { headers }));
const cloudPost = (body: unknown, headers: Record<string, string> = { authorization: "Bearer tok", "content-type": "application/json" }) =>
  cloud.POST(new Request("http://localhost:3457/api/site-notes/cloud", { method: "POST", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  listOutbox.mockReturnValue([]);
  publicSharingOn.mockReturnValue(false);
  takeOutbox.mockReturnValue([]);
  notesForHost.mockResolvedValue({ ok: true, value: [] });
  reportOutcome.mockResolvedValue({ ok: true, value: null });
  uploadNote.mockResolvedValue({ ok: true, value: { versionId: "v1", findings: [] } });
  bearerUser.mockResolvedValue({ id: "u1", email: null, name: null, avatar: null });
  serviceClient.mockReturnValue({ kind: "service" });
});

describe("GET /api/site-notes", () => {
  it("returns the public-sharing switch and the outbox", async () => {
    publicSharingOn.mockReturnValue(true);
    listOutbox.mockReturnValue([{ id: "a" }]);
    const res = await get();
    expect(await res.json()).toEqual({ public: true, outbox: [{ id: "a" }] });
  });

  it("refuses another host", async () => {
    const res = await get("http://localhost:3457/api/site-notes", { host: "evil.com" });
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/site-notes", () => {
  it("turns public sharing on", async () => {
    const res = await put({ on: true });
    expect(setPublicSharing).toHaveBeenCalledWith(true);
    expect(await res.json()).toEqual({ public: true, outbox: [] });
  });

  it("turns public sharing off and drops what was waiting", async () => {
    const res = await put({ on: false });
    expect(setPublicSharing).toHaveBeenCalledWith(false);
    expect(takeOutbox).toHaveBeenCalledWith(undefined);
    expect(await res.json()).toEqual({ public: false, outbox: [] });
  });

  it("refuses a body that isn't a boolean", async () => {
    const res = await put({ on: "yes" });
    expect(res.status).toBe(400);
    expect(setPublicSharing).not.toHaveBeenCalled();
  });

  it("refuses another host", async () => {
    const res = await put({ on: true }, { host: "evil.com", "x-weft-token": "1", "content-type": "application/json" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/site-notes", () => {
  it("discards the notes it was given", async () => {
    const res = await post({ action: "discard", ids: ["a"] });
    expect(takeOutbox).toHaveBeenCalledWith(["a"]);
    expect(await res.json()).toEqual({ outbox: [] });
  });

  it("discards every note when no ids are given", async () => {
    await post({ action: "discard" });
    expect(takeOutbox).toHaveBeenCalledWith(undefined);
  });

  it("drops ids that aren't strings", async () => {
    await post({ action: "discard", ids: ["a", 5, null] });
    expect(takeOutbox).toHaveBeenCalledWith(["a"]);
  });

  it("sends the notes through the remote, with the local outbox as the queue", async () => {
    publicSharingOn.mockReturnValue(true);
    sendOutbox.mockResolvedValue([{ id: "a", sent: true }]);
    const res = await post({ action: "send", ids: ["a"] });
    expect(sendOutbox).toHaveBeenCalledWith(["a"], {
      take: expect.any(Function) as (ids?: string[]) => unknown[],
      requeue: expect.any(Function) as (i: unknown) => void,
      upload: expect.any(Function) as (u: unknown) => Promise<unknown>,
    });
    expect(await res.json()).toEqual({ results: [{ id: "a", sent: true }], outbox: [] });
  });

  it("takes the notes off the outbox and requeues the ones that didn't go", async () => {
    publicSharingOn.mockReturnValue(true);
    const item: OutboxItem = { id: "a", host: "example.com", path: "/p", body: "b", queuedAt: "2026-01-01T00:00:00.000Z" };
    takeOutbox.mockReturnValue([item]);
    await post({ action: "send" });
    const deps = sendOutbox.mock.calls[0]?.[1];
    if (!deps) throw new Error("sendOutbox was not called");
    expect(deps.take(undefined)).toEqual([item]);
    deps.requeue(item);
    expect(queueOutbox).toHaveBeenCalledWith(item);
    await deps.upload({ host: "example.com", path: "/p", body: "b", scope: "public" });
    expect(uploadRemote).toHaveBeenCalledWith({ host: "example.com", path: "/p", body: "b", scope: "public" }, remoteDeps);
  });

  it("refuses to send when public sharing is off", async () => {
    const res = await post({ action: "send" });
    expect(res.status).toBe(400);
    expect(sendOutbox).not.toHaveBeenCalled();
  });

  it("refuses an unknown action", async () => {
    const res = await post({ action: "hack" });
    expect(res.status).toBe(400);
  });

  it("refuses another host", async () => {
    const res = await post({ action: "send" }, { host: "evil.com", "x-weft-token": "1", "content-type": "application/json" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/site-notes/cloud", () => {
  it("answers with the notes for the host", async () => {
    const res = await cloudGet();
    expect(notesForHost).toHaveBeenCalledWith(expect.anything(), "u1", "example.com", false);
    expect(await res.json()).toEqual({ ok: true, value: [] });
  });

  it("asks for the contributor's view", async () => {
    await cloudGet("http://localhost:3457/api/site-notes/cloud?host=example.com&contributor=1");
    expect(notesForHost).toHaveBeenCalledWith(expect.anything(), "u1", "example.com", true);
  });

  it("lowercases the host", async () => {
    await cloudGet("http://localhost:3457/api/site-notes/cloud?host=Example.COM");
    expect(notesForHost).toHaveBeenCalledWith(expect.anything(), "u1", "example.com", false);
  });

  it("asks for an empty host when none is given", async () => {
    await cloudGet("http://localhost:3457/api/site-notes/cloud");
    expect(notesForHost).toHaveBeenCalledWith(expect.anything(), "u1", "", false);
  });

  it("reports a refusal from the rules", async () => {
    notesForHost.mockResolvedValue({ ok: false, status: 400, error: "bad-host" });
    const res = await cloudGet();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-host" });
  });

  it("carries the safety findings back", async () => {
    notesForHost.mockResolvedValue({ ok: false, status: 422, error: "rejected", findings: [{ rule: "orders", message: "x" }] });
    const res = await cloudGet();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "rejected", findings: [{ rule: "orders", message: "x" }] });
  });

  it("is 503 when the deployment has no service key", async () => {
    serviceClient.mockReturnValue(null);
    const res = await cloudGet();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unconfigured" });
  });

  it("is 401 when there is no bearer token", async () => {
    bearerUser.mockResolvedValue(null);
    const res = await cloudGet();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
  });
});

describe("POST /api/site-notes/cloud", () => {
  it("uploads a note", async () => {
    const res = await cloudPost({ action: "upload", host: "example.com", path: "/p", body: "b", scope: "public" });
    expect(uploadNote).toHaveBeenCalledWith(expect.anything(), "u1", { host: "example.com", path: "/p", body: "b", scope: "public" });
    expect(await res.json()).toEqual({ ok: true, value: { versionId: "v1", findings: [] } });
  });

  it("uploads a team note with its workspace", async () => {
    await cloudPost({ action: "upload", host: "example.com", path: "/p", body: "b", scope: "team", orgId: "11111111-1111-4111-8111-111111111111" });
    expect(uploadNote).toHaveBeenCalledWith(expect.anything(), "u1", { host: "example.com", path: "/p", body: "b", scope: "team", orgId: "11111111-1111-4111-8111-111111111111" });
  });

  it("records an outcome", async () => {
    const res = await cloudPost({ action: "report", versionId: "11111111-1111-4111-8111-111111111111", outcome: "success" });
    expect(reportOutcome).toHaveBeenCalledWith(expect.anything(), "u1", { action: "report", versionId: "11111111-1111-4111-8111-111111111111", outcome: "success" });
    expect(await res.json()).toEqual({ ok: true, value: null });
  });

  it("records the step that failed", async () => {
    await cloudPost({ action: "report", versionId: "11111111-1111-4111-8111-111111111111", outcome: "failure", step: "3. [failed] click" });
    expect(reportOutcome).toHaveBeenCalledWith(expect.anything(), "u1", expect.objectContaining({ step: "3. [failed] click" }));
  });

  it("refuses a body that isn't JSON", async () => {
    const res = await cloud.POST(new Request("http://localhost:3457/api/site-notes/cloud", { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-request" });
  });

  it("refuses a body that doesn't fit the shape", async () => {
    const res = await cloudPost({ action: "upload", host: "", path: "/p", body: "b", scope: "public" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-request" });
  });

  it("refuses an unknown action", async () => {
    const res = await cloudPost({ action: "hack" });
    expect(res.status).toBe(400);
  });

  it("is 503 when the deployment has no service key", async () => {
    serviceClient.mockReturnValue(null);
    const res = await cloudPost({ action: "upload", host: "example.com", path: "/p", body: "b", scope: "public" });
    expect(res.status).toBe(503);
  });

  it("is 401 when there is no bearer token", async () => {
    bearerUser.mockResolvedValue(null);
    const res = await cloudPost({ action: "upload", host: "example.com", path: "/p", body: "b", scope: "public" });
    expect(res.status).toBe(401);
  });

  it("reports a refusal from the rules", async () => {
    uploadNote.mockResolvedValue({ ok: false, status: 422, error: "rejected", findings: [{ rule: "orders", message: "x" }] });
    const res = await cloudPost({ action: "upload", host: "example.com", path: "/p", body: "b", scope: "public" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "rejected", findings: [{ rule: "orders", message: "x" }] });
  });
});
