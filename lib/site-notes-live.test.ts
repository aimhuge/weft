import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDeps } from "./site-notes-capture";
import type { SiteNote } from "./site-notes-format";
import type { ReadDeps } from "./site-notes-read";
import type { RemoteDeps, UploadResult } from "./site-notes-remote";
import type { OutboxItem } from "./site-notes-store";

// Site notes wired to the real Mac: the account's token, Haiku, ~/.weft/site-notes and weft.zip.

type Session = { access_token?: string | null; user?: { email?: string | null; user_metadata?: Record<string, unknown> } | null } | null;
type GetSessionMock = () => Promise<{ data: { session: Session } }>;

const getSession = vi.fn<GetSessionMock>(() => Promise.resolve({ data: { session: null } }));
vi.mock("./account", () => ({ accountClient: () => ({ auth: { getSession } }) }));

const complete = vi.fn<() => Promise<string>>(() => Promise.resolve("DRAFT"));
vi.mock("./haiku", () => ({ complete }));

const cards = new Map<string, { cwd?: string }>();
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id) }));

// The read takes the card, the url and the two readers it asks for.
const notesForUrl = vi.fn<(cardId: string | undefined, url: string, deps: ReadDeps) => Promise<string>>(() => Promise.resolve("NOTES"));
vi.mock("./site-notes-read", () => ({ notesForUrl }));

const remoteNotes = vi.fn<(host: string, contributor: boolean, deps: RemoteDeps) => Promise<SiteNote[]>>(() => Promise.resolve([]));
const reportRemote = vi.fn<(report: { versionId: string; outcome: "success" | "failure"; step?: string }, deps: RemoteDeps) => Promise<boolean>>(() => Promise.resolve(true));
const uploadRemote = vi.fn<(upload: { host: string; path: string; body: string; scope: "team" | "public" }, deps: RemoteDeps) => Promise<UploadResult>>(() => Promise.resolve({ ok: true, versionId: "v1" }));
vi.mock("./site-notes-remote", () => ({ remoteNotes, reportRemote, uploadRemote }));

const markLocalOutcome = vi.fn<(host: string, notePath: string, outcome: "success" | "failure") => void>();
const publicSharingOn = vi.fn(() => false);
const queueOutbox = vi.fn<(item: Omit<OutboxItem, "id" | "queuedAt">) => void>();
const readHostNotes = vi.fn(() => [] as SiteNote[]);
const readNote = vi.fn(() => null as SiteNote | null);
const writeNote = vi.fn(() => "/tmp/note.md");
vi.mock("./site-notes-store", () => ({ markLocalOutcome, publicSharingOn, queueOutbox, readHostNotes, readNote, writeNote }));

// The capture takes the card, the ask and the deps it works through.
const captureAfterTurn = vi.fn<(cardId: string, ask: string, deps: CaptureDeps) => Promise<void>>(() => Promise.resolve());
vi.mock("./site-notes-capture", () => ({ captureAfterTurn }));

const live = await import("./site-notes-live");

beforeEach(() => {
  vi.clearAllMocks();
  cards.clear();
  getSession.mockResolvedValue({ data: { session: null } });
  notesForUrl.mockResolvedValue("NOTES");
  remoteNotes.mockResolvedValue([]);
  reportRemote.mockResolvedValue(true);
  uploadRemote.mockResolvedValue({ ok: true, versionId: "v1" });
  publicSharingOn.mockReturnValue(false);
  readHostNotes.mockReturnValue([]);
  readNote.mockReturnValue(null);
  complete.mockResolvedValue("DRAFT");
});

// The readers the read was handed on its last call, and the deps the capture was handed on its last one.
// Both are guarded: a test that reaches for them before the call happened fails loudly.
function readDeps(): ReadDeps {
  const deps = notesForUrl.mock.calls[0]?.[2];
  if (!deps) throw new Error("notesForUrl was not called");
  return deps;
}

function captureDeps(): CaptureDeps {
  const deps = captureAfterTurn.mock.calls[0]?.[2];
  if (!deps) throw new Error("captureAfterTurn was not called");
  return deps;
}

describe("remoteDeps", () => {
  it("carries the signed-in user's own token", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok-123" } } });
    expect(await live.remoteDeps.token()).toBe("tok-123");
  });

  it("has no token when signed out", async () => {
    expect(await live.remoteDeps.token()).toBeNull();
  });

  it("has no token when the session has none", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: null } } });
    expect(await live.remoteDeps.token()).toBeNull();
  });

  it("fetches through the global fetch", async () => {
    const original = globalThis.fetch;
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}", { status: 200 })));
    globalThis.fetch = fake;
    try {
      const res = await live.remoteDeps.fetchFn("https://weft.zip/api/site-notes/cloud", { method: "GET" });
      expect(res.status).toBe(200);
      expect(fake).toHaveBeenCalledWith("https://weft.zip/api/site-notes/cloud", { method: "GET" });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("knownValues", () => {
  it("is empty when signed out", async () => {
    expect(await live.knownValues("c1")).toEqual([]);
  });

  it("names the user's email and the part before the @", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "ada@example.com" } } } });
    expect(await live.knownValues("c1")).toEqual(["ada@example.com", "ada"]);
  });

  it("names the user from the session's metadata", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { user_metadata: { full_name: "Ada L", name: "Ada", user_name: "ada_l", preferred_username: "ada", other: 5 } } } } });
    expect(await live.knownValues("c1")).toEqual(["Ada L", "Ada", "ada_l", "ada"]);
  });

  it("skips metadata that isn't a string", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { user_metadata: { full_name: 42, name: "Ada" } } } } });
    expect(await live.knownValues("c1")).toEqual(["Ada"]);
  });

  it("names the card's folder", async () => {
    cards.set("c1", { cwd: "/Users/ada/code/my-project" });
    expect(await live.knownValues("c1")).toEqual(["my-project"]);
  });

  it("has no folder name when the card has no cwd", async () => {
    cards.set("c1", {});
    expect(await live.knownValues("c1")).toEqual([]);
  });

  it("has no folder name when the card is gone", async () => {
    expect(await live.knownValues("missing")).toEqual([]);
  });
});

describe("siteNotesForUrl", () => {
  it("reads the local notes and the remote ones for the host", async () => {
    await live.siteNotesForUrl("c1", "https://example.com/settings");
    expect(notesForUrl).toHaveBeenCalledWith("c1", "https://example.com/settings", {
      local: expect.any(Function) as (host: string) => SiteNote[],
      remote: expect.any(Function) as (host: string) => Promise<SiteNote[]>,
    });
  });

  it("hands the local reader the host it asks for", async () => {
    await live.siteNotesForUrl("c1", "https://example.com/settings");
    const deps = readDeps();
    deps.local("example.com");
    expect(readHostNotes).toHaveBeenCalledWith("example.com");
  });

  it("asks the remote for the host, as a contributor when public sharing is on", async () => {
    publicSharingOn.mockReturnValue(true);
    await live.siteNotesForUrl("c1", "https://example.com/settings");
    const deps = readDeps();
    await deps.remote("example.com");
    expect(remoteNotes).toHaveBeenCalledWith("example.com", true, live.remoteDeps);
  });

  it("asks the remote as a plain reader when public sharing is off", async () => {
    await live.siteNotesForUrl("c1", "https://example.com/settings");
    const deps = readDeps();
    await deps.remote("example.com");
    expect(remoteNotes).toHaveBeenCalledWith("example.com", false, live.remoteDeps);
  });

  it("is empty when the read fails", async () => {
    notesForUrl.mockRejectedValue(new Error("disk"));
    expect(await live.siteNotesForUrl("c1", "https://example.com/settings")).toBe("");
  });
});

describe("siteNotesAfterTurn", () => {
  it("captures with the real Mac's pieces", async () => {
    await live.siteNotesAfterTurn("c1", "open the settings");
    expect(captureAfterTurn).toHaveBeenCalledWith("c1", "open the settings", expect.objectContaining({ complete, publicOn: expect.any(Function) as () => boolean }));
  });

  it("gives the capture the card's known names", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "ada@example.com" } } } });
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    expect(await deps.known()).toEqual(["ada@example.com", "ada"]);
  });

  it("gives the capture Haiku for the draft", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    expect(await deps.complete("prompt")).toBe("DRAFT");
  });

  it("reads the note already on disk for the host and path", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    deps.readLocal("example.com", "/settings");
    expect(readNote).toHaveBeenCalledWith("example.com", "/settings");
  });

  it("writes the note to disk", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    deps.writeLocal({ host: "example.com", path: "/settings", body: "b" });
    expect(writeNote).toHaveBeenCalledWith({ host: "example.com", path: "/settings", body: "b" });
  });

  it("marks the local note's outcome", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    deps.markLocal("example.com", "/settings", "success");
    expect(markLocalOutcome).toHaveBeenCalledWith("example.com", "/settings", "success");
  });

  it("uploads the note to the team", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    await deps.upload({ host: "example.com", path: "/settings", body: "b", scope: "team" });
    expect(uploadRemote).toHaveBeenCalledWith({ host: "example.com", path: "/settings", body: "b", scope: "team" }, live.remoteDeps);
  });

  it("reports the outcome of a cloud note", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    await deps.report({ versionId: "v1", outcome: "success" });
    expect(reportRemote).toHaveBeenCalledWith({ versionId: "v1", outcome: "success" }, live.remoteDeps);
  });

  it("says whether public sharing is on", async () => {
    publicSharingOn.mockReturnValue(true);
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    expect(deps.publicOn()).toBe(true);
  });

  it("queues a note for the public outbox", async () => {
    await live.siteNotesAfterTurn("c1", "ask");
    const deps = captureDeps();
    deps.queueOutbox({ host: "example.com", path: "/settings", body: "b" });
    expect(queueOutbox).toHaveBeenCalledWith({ host: "example.com", path: "/settings", body: "b" });
  });

  it("swallows a capture that fails", async () => {
    captureAfterTurn.mockRejectedValue(new Error("no trail"));
    await expect(live.siteNotesAfterTurn("c1", "ask")).resolves.toBeUndefined();
  });
});
