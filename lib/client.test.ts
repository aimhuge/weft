// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_REPLY_MS, api, mergeThread, type NewCardInput } from "./client";
import type { ThreadItem } from "./types";

type FetchCall = [string, RequestInit];

function respond(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: init.status ?? 200, statusText: init.statusText })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const lastCall = (fetch: ReturnType<typeof respond>) => fetch.mock.lastCall as unknown as FetchCall;

afterEach(() => vi.unstubAllGlobals());

describe("api calls", () => {
  it("sends JSON with the write header and returns the parsed body", async () => {
    const fetch = respond({ card: { id: "c1" } });
    await expect(api.rename("c1", "New name")).resolves.toEqual({ card: { id: "c1" } });
    const [url, init] = lastCall(fetch);
    expect(url).toBe("/api/cards/c1");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-weft-token": "1" });
    expect(JSON.parse(init.body as string)).toEqual({ title: "New name" });
  });

  it("sends no body when there is none", async () => {
    const fetch = respond({ cards: [] });
    await api.list();
    expect(lastCall(fetch)[1].body).toBeUndefined();
  });

  it("throws the server's error message", async () => {
    respond({ error: "No such card." }, { status: 404, statusText: "Not Found" });
    await expect(api.stop("x")).rejects.toThrow("No such card.");
  });

  it("falls back to the status text when the error has no message", async () => {
    respond({}, { status: 500, statusText: "Internal Server Error" });
    await expect(api.copilot()).rejects.toThrow("Internal Server Error");
  });

  it("says the server couldn't be reached when the connection drops, instead of 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(api.stop("x")).rejects.toThrow(/Couldn't reach Weft's server/);
    await expect(api.transcribe(new Blob(["x"]))).rejects.toThrow(/Couldn't reach Weft's server/);
  });

  it("lets a caller's own abort through untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))));
    await expect(api.stop("x")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports the status when a failed reply isn't JSON, and the bad reply when a good one isn't", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>oops</html>", { status: 502 }))));
    await expect(api.copilot()).rejects.toThrow("Request failed (502).");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>hi</html>", { status: 200 }))));
    await expect(api.copilot()).rejects.toThrow("isn't JSON");
  });

  // Pins every route and payload the board relies on.
  const input: NewCardInput = { prompt: "p", cwd: "/w", backend: "claude", start: true };
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ["list", () => api.list(), "GET", "/api/cards", undefined],
    ["create", () => api.create(input), "POST", "/api/cards", input],
    ["move", () => api.move("c1", "done"), "PATCH", "/api/cards/c1", { column: "done" }],
    ["setMode", () => api.setMode("c1", "auto"), "PATCH", "/api/cards/c1", { permissionMode: "auto" }],
    ["archive", () => api.archive("c1", true), "PATCH", "/api/cards/c1", { archived: true }],
    ["setStarred", () => api.setStarred("c1", true), "PATCH", "/api/cards/c1", { starred: true }],
    ["setTags", () => api.setTags("c1", ["bug"]), "PATCH", "/api/cards/c1", { tags: ["bug"] }],
    ["reportBreak", () => api.reportBreak({ kind: "build", file: "./a.ts (1:1)" }), "POST", "/api/broke", { kind: "build", file: "./a.ts (1:1)" }],
    ["clearBreak", () => api.clearBreak("c1"), "PATCH", "/api/cards/c1", { broke: null }],
    ["remove", () => api.remove("c1"), "DELETE", "/api/cards/c1", undefined],
    ["send", () => api.send("c1", "hi"), "POST", "/api/cards/c1/messages", { text: "hi" }],
    ["schedule", () => api.schedule("c1", "later", 123), "POST", "/api/cards/c1/scheduled", { text: "later", at: 123 }],
    ["unschedule", () => api.unschedule("c1", "m1"), "DELETE", "/api/cards/c1/scheduled", { messageId: "m1" }],
    ["answer", () => api.answer("c1", true, { q: "a" }, "p1"), "POST", "/api/cards/c1/permission", { allow: true, answers: { q: "a" }, pendingId: "p1" }],
    ["stop", () => api.stop("c1"), "POST", "/api/cards/c1/stop", undefined],
    ["release", () => api.release("c1"), "POST", "/api/cards/c1/release", undefined],
    ["devStatus", () => api.devStatus("c1"), "GET", "/api/cards/c1/dev", undefined],
    ["devAction", () => api.devAction("c1", "restart"), "POST", "/api/cards/c1/dev", { action: "restart" }],
    ["copilot", () => api.copilot(), "GET", "/api/copilot", undefined],
    ["resetCopilot", () => api.resetCopilot(), "POST", "/api/copilot/reset", undefined],
    ["copilotSuggestions", () => api.copilotSuggestions(), "GET", "/api/copilot/suggestions", undefined],
    ["copilotChipClicked", () => api.copilotChipClicked("Hi"), "POST", "/api/copilot/suggestions", { text: "Hi" }],
    ["settings", () => api.settings(), "GET", "/api/settings", undefined],
    ["saveSettings", () => api.saveSettings({ keepAliveMinutes: 5 }), "PATCH", "/api/settings", { keepAliveMinutes: 5 }],
    ["addProject", () => api.addProject("/p"), "POST", "/api/projects", { path: "/p" }],
    ["newProject", () => api.newProject("/dev", "app"), "POST", "/api/projects/new", { parent: "/dev", name: "app" }],
    ["removeProject", () => api.removeProject("/p"), "DELETE", "/api/projects", { path: "/p" }],
    ["loginStatus", () => api.loginStatus(), "GET", "/api/login", undefined],
    ["login", () => api.login("puku", "input", "code"), "POST", "/api/login", { backend: "puku", action: "input", text: "code" }],
    ["warm", () => api.warm({ cwd: "/w" }), "POST", "/api/warm", { cwd: "/w" }],
    ["newThreadPage", () => api.newThreadPage(), "POST", "/api/new-thread-page", {}],
    ["mark star", () => api.mark("c1", { starred: true }), "PATCH", "/api/cards/c1", { starred: true }],
    ["mark tags", () => api.mark("c1", { tags: ["bug"] }), "PATCH", "/api/cards/c1", { tags: ["bug"] }],
    ["getShare", () => api.getShare("c1"), "GET", "/api/cards/c1/share", undefined],
    ["setShare", () => api.setShare("c1", { mode: "password", password: "pw" }), "PUT", "/api/cards/c1/share", { mode: "password", password: "pw" }],
    ["tags", () => api.tags(), "GET", "/api/tags", undefined],
    ["createTag", () => api.createTag("bug", "#ff0000", "Broken"), "POST", "/api/tags", { name: "bug", color: "#ff0000", description: "Broken" }],
    ["updateTag", () => api.updateTag("bug", { rename: "defect" }), "PATCH", "/api/tags", { name: "bug", rename: "defect" }],
    ["deleteTag", () => api.deleteTag("bug"), "DELETE", "/api/tags", { name: "bug" }],
    ["searchPrompts", () => api.searchPrompts("a&b c"), "GET", "/api/search?q=a%26b%20c", undefined],
    ["thread", () => api.thread("c1"), "GET", "/api/cards/c1/thread", undefined],
    ["skills", () => api.skills(), "GET", "/api/skills", undefined],
    ["skills in a folder", () => api.skills("/a b"), "GET", "/api/skills?cwd=%2Fa%20b", undefined],
    ["dictation", () => api.dictation(), "GET", "/api/transcribe", undefined],
    ["repos", () => api.repos(), "GET", "/api/repos", undefined],
    ["repos fresh", () => api.repos(true), "GET", "/api/repos?fresh=1", undefined],
    ["githubRepos", () => api.githubRepos(), "GET", "/api/repos/github", undefined],
    ["githubRepos fresh", () => api.githubRepos(true), "GET", "/api/repos/github?fresh=1", undefined],
    ["cloneRepo", () => api.cloneRepo("o/r"), "POST", "/api/repos/clone", { fullName: "o/r" }],
  ];

  it.each(cases)("%s", async (_name, run, method, url, body) => {
    const fetch = respond({ ok: true });
    await run();
    const [gotUrl, init] = lastCall(fetch);
    expect(gotUrl).toBe(url);
    expect(init.method).toBe(method);
    expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
  });
});

describe("api.transcribe", () => {
  it("posts the audio as is and returns the text", async () => {
    const fetch = respond({ text: "hello" });
    const audio = new Blob(["x"], { type: "audio/ogg" });
    await expect(api.transcribe(audio)).resolves.toBe("hello");
    const [url, init] = lastCall(fetch);
    expect(url).toBe("/api/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-weft-token": "1", "content-type": "audio/ogg" });
    expect(init.body).toBe(audio);
  });

  it("assumes webm for untyped audio, and empty text when none came back", async () => {
    const fetch = respond({});
    await expect(api.transcribe(new Blob(["x"]))).resolves.toBe("");
    expect((lastCall(fetch)[1].headers as Record<string, string>)["content-type"]).toBe("audio/webm");
  });

  it("throws the server's error, or the status text", async () => {
    respond({ error: "No model." }, { status: 503 });
    await expect(api.transcribe(new Blob(["x"]))).rejects.toThrow("No model.");
    respond({}, { status: 502, statusText: "Bad Gateway" });
    await expect(api.transcribe(new Blob(["x"]))).rejects.toThrow("Bad Gateway");
  });
});

describe("api.uploadAttachment", () => {
  class FakeXHR {
    static last: FakeXHR;
    method = "";
    url = "";
    headers: Record<string, string> = {};
    body: unknown;
    status = 0;
    responseText = "";
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void; onload?: () => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onloadend?: () => void;
    aborted = false;
    abort() {
      this.aborted = true;
    }
    constructor() {
      FakeXHR.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      this.body = body;
    }
    finish(status: number, responseText: string) {
      this.status = status;
      this.responseText = responseText;
      this.onload?.();
      this.onloadend?.();
    }
  }

  beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXHR));

  const saved = { name: "a b.png", path: "/att/a.png", url: "/api/attachments/a.png", kind: "image", bytes: 3 };

  it("posts the file with its name and type, and resolves to the saved attachment", async () => {
    const file = new Blob(["abc"], { type: "image/png" });
    const done = api.uploadAttachment(file, "a b.png");
    const xhr = FakeXHR.last;
    expect([xhr.method, xhr.url]).toEqual(["POST", "/api/attachments"]);
    expect(xhr.headers).toEqual({ "x-weft-token": "1", "x-filename": "a%20b.png", "content-type": "image/png" });
    expect(xhr.body).toBe(file);
    xhr.finish(200, JSON.stringify(saved));
    await expect(done).resolves.toEqual(saved);
  });

  it("sends an untyped file as octet-stream", () => {
    void api.uploadAttachment(new Blob(["x"]), "f");
    expect(FakeXHR.last.headers["content-type"]).toBe("application/octet-stream");
  });

  it("reports progress only when the size is known", () => {
    const onProgress = vi.fn();
    void api.uploadAttachment(new Blob(["x"]), "f", onProgress);
    const progress = FakeXHR.last.upload.onprogress!;
    progress({ lengthComputable: false, loaded: 1, total: 0 });
    progress({ lengthComputable: true, loaded: 25, total: 100 });
    expect(onProgress.mock.calls).toEqual([[0.25]]);
    // No callback is fine too.
    void api.uploadAttachment(new Blob(["x"]), "f");
    expect(() => FakeXHR.last.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 2 })).not.toThrow();
  });

  it("rejects with the server's error", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(413, JSON.stringify({ error: "Too big." }));
    await expect(done).rejects.toThrow("Too big.");
  });

  it("rejects with the status when the reply isn't JSON", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(502, "<html>");
    await expect(done).rejects.toThrow("Upload failed (502).");
  });

  it("rejects a 2xx reply with no saved path", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(200, "{}");
    await expect(done).rejects.toThrow("Upload failed (200).");
  });

  it("rejects a 1xx status even with a path", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(101, JSON.stringify(saved));
    await expect(done).rejects.toThrow("Upload failed (101).");
  });

  it("gives up when the server doesn't answer a minute after the bytes are sent", async () => {
    vi.useFakeTimers();
    try {
      const done = api.uploadAttachment(new Blob(["x"]), "f");
      FakeXHR.last.upload.onload!();
      vi.advanceTimersByTime(UPLOAD_REPLY_MS);
      await expect(done).rejects.toThrow("didn't answer in a minute");
      expect(FakeXHR.last.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps waiting no longer once the reply arrives", async () => {
    vi.useFakeTimers();
    try {
      const done = api.uploadAttachment(new Blob(["x"]), "f");
      FakeXHR.last.upload.onload!();
      FakeXHR.last.finish(200, JSON.stringify(saved));
      vi.advanceTimersByTime(UPLOAD_REPLY_MS);
      await expect(done).resolves.toEqual(saved);
      expect(FakeXHR.last.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects on a network error", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.onerror!();
    await expect(done).rejects.toThrow("Upload failed.");
  });
});

describe("mergeThread", () => {
  const item = (text: string) => ({ kind: "text", text }) as unknown as ThreadItem;

  it("lays live items over the snapshot by index and keeps the rest", () => {
    const live: ThreadItem[] = [];
    live[1] = item("live 1");
    live[3] = item("live 3");
    expect(mergeThread([item("a"), item("b"), item("c")], live)).toEqual([item("a"), item("live 1"), item("c"), item("live 3")]);
  });

  it("doesn't change the snapshot it was given", () => {
    const snapshot = [item("a")];
    mergeThread(snapshot, [item("b")]);
    expect(snapshot).toEqual([item("a")]);
  });
});

describe("api calls the board makes less often", () => {
  it("switches one card's CLI and a column's cards", async () => {
    let fetch = respond({ card: { id: "c1" } });
    await api.switchBackend("c1", "codex", true, "gpt");
    expect(lastCall(fetch)[0]).toBe("/api/cards/c1/switch-backend");
    expect(JSON.parse(lastCall(fetch)[1].body as string)).toEqual({ backend: "codex", replay: true, model: "gpt" });

    fetch = respond({ switched: ["a"], failed: [], pending: [] });
    await api.switchBackends(["a", "b"], "puku");
    expect(lastCall(fetch)[0]).toBe("/api/cards/switch-backend");
    expect(JSON.parse(lastCall(fetch)[1].body as string)).toEqual({ ids: ["a", "b"], backend: "puku" });
  });

  it("signs in with or without a next page", async () => {
    let fetch = respond({ url: "u" });
    await api.signIn("github", "/board");
    expect(JSON.parse(lastCall(fetch)[1].body as string)).toEqual({ action: "oauth", provider: "github", next: "/board" });
    fetch = respond({ url: "u" });
    await api.signIn("github");
    expect(JSON.parse(lastCall(fetch)[1].body as string)).toEqual({ action: "oauth", provider: "github" });
  });

  it("starts and stops a folder's issue sync", async () => {
    let fetch = respond({ folder: "/f", added: 1, updated: 0, archived: 0 });
    await api.importIssues("/f");
    expect(lastCall(fetch)[1].method).toBe("POST");
    fetch = respond({ folders: [] });
    await api.stopIssues("/f");
    expect(lastCall(fetch)[1].method).toBe("DELETE");
    expect(lastCall(fetch)[0]).toBe("/api/github/issues");
  });
});
