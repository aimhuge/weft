import { describe, expect, it } from "vitest";
import { api, call, UNREACHABLE, type NewCardInput } from "./client-api";
import { bodyOf, callOf, fetchMock } from "./client-api.harness";

// The fetch client: one method per server route. This file covers the fetch itself and the methods
// that drive a card; the connectors and the projects live in lib/client-api-connectors.test.ts, and
// the upload and the transcribe in lib/client-api-upload.test.ts. The fake fetch and the helpers
// that read it live in lib/client-api.harness.ts.

describe("call", () => {
  it("sends the token header and the JSON content type", async () => {
    await call("POST", "/api/thing", { a: 1 });
    const { init } = callOf();
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "content-type": "application/json", "x-weft-token": "1" });
    expect(bodyOf()).toEqual({ a: 1 });
  });

  it("sends no body when there is none", async () => {
    await call("GET", "/api/thing");
    expect(callOf().init?.body).toBeUndefined();
  });

  it("passes an abort signal through", async () => {
    const controller = new AbortController();
    await call("GET", "/api/thing", undefined, controller.signal);
    expect(callOf().init?.signal).toBe(controller.signal);
  });

  it("turns a dropped connection into a readable error", async () => {
    fetchMockOnce(new TypeError("Failed to fetch"));
    await expect(call("GET", "/api/thing")).rejects.toThrow(UNREACHABLE);
  });

  it("lets an abort through untouched", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMockOnce(abort);
    await expect(call("GET", "/api/thing")).rejects.toBe(abort);
  });

  it("throws the server's error on a failed reply", async () => {
    fetchMockOnce(new Response(JSON.stringify({ error: "no such card" }), { status: 404 }));
    await expect(call("GET", "/api/thing")).rejects.toThrow("no such card");
  });

  it("falls back to the status when the reply carries no error", async () => {
    fetchMockOnce(new Response("{}", { status: 500, statusText: "Server Error" }));
    await expect(call("GET", "/api/thing")).rejects.toThrow("Server Error");
  });

  it("falls back to the status when there is no status text either", async () => {
    fetchMockOnce(new Response("{}", { status: 500, statusText: "" }));
    await expect(call("GET", "/api/thing")).rejects.toThrow("Request failed (500).");
  });

  // A dev server that restarted answers with an HTML error page: the status says it failed, so
  // that is a failed call, not a JSON parse error.
  it("reads a failed reply that isn't JSON as an empty body", async () => {
    fetchMockOnce(new Response("<html>oops</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(call("GET", "/api/thing")).rejects.toThrow("Bad Gateway");
  });

  it("says so when a successful reply isn't JSON", async () => {
    fetchMockOnce(new Response("<html>oops</html>", { status: 200 }));
    await expect(call("GET", "/api/thing")).rejects.toThrow("Weft's server sent a reply that isn't JSON.");
  });
});

describe("the api methods", () => {
  it("lists the cards", async () => {
    await api.list();
    expect(callOf().url).toBe("/api/cards");
    expect(callOf().init?.method).toBe("GET");
  });

  it("creates a card", async () => {
    const input: NewCardInput = { prompt: "hi", cwd: "/x", backend: "claude", start: true };
    await api.create(input);
    expect(callOf().url).toBe("/api/cards");
    expect(callOf().init?.method).toBe("POST");
    expect(bodyOf()).toEqual(input);
  });

  it("moves a card to a column", async () => {
    await api.move("c1", "review");
    expect(callOf().url).toBe("/api/cards/c1");
    expect(callOf().init?.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ column: "review" });
  });

  it("re-points a card at another folder", async () => {
    await api.setCwd("c1", "/other");
    expect(bodyOf()).toEqual({ cwd: "/other" });
  });

  it("reorders a card", async () => {
    await api.reorder("c1", "c0");
    expect(bodyOf()).toEqual({ before: "c0" });
  });

  it("renames a card", async () => {
    await api.rename("c1", "New name");
    expect(bodyOf()).toEqual({ title: "New name" });
  });

  it("sets a card's permission mode", async () => {
    await api.setMode("c1", "acceptEdits");
    expect(bodyOf()).toEqual({ permissionMode: "acceptEdits" });
  });

  it("sets a card's agent", async () => {
    await api.setAgent("c1", "copywriter");
    expect(bodyOf()).toEqual({ agent: "copywriter" });
  });

  it("archives a card", async () => {
    await api.archive("c1", true);
    expect(bodyOf()).toEqual({ archived: true });
  });

  it("marks a card, starred and tagged", async () => {
    await api.mark("c1", { starred: true, tags: ["ui"] });
    expect(bodyOf()).toEqual({ starred: true, tags: ["ui"] });
  });

  it("reads and updates a card's share link", async () => {
    await api.getShare("c1");
    expect(callOf().url).toBe("/api/cards/c1/share");
    await api.setShare("c1", { mode: "public" });
    expect(callOf().init?.method).toBe("PUT");
  });

  it("reads the tag catalog and writes tags", async () => {
    await api.tags();
    expect(callOf().url).toBe("/api/tags");
    await api.createTag("ui", "#fff", "the ui");
    expect(bodyOf()).toEqual({ name: "ui", color: "#fff", description: "the ui" });
    await api.updateTag("ui", { rename: "ux" });
    expect(bodyOf()).toEqual({ name: "ui", rename: "ux" });
    await api.deleteTag("ui");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("reports and clears a break", async () => {
    await api.reportBreak({ kind: "build", at: 5, file: "a.ts" });
    expect(callOf().url).toBe("/api/broke");
    expect(bodyOf()).toEqual({ kind: "build", at: 5, file: "a.ts" });
    await api.clearBreak("c1");
    expect(bodyOf()).toEqual({ broke: null });
  });

  it("sets a card's tags", async () => {
    await api.setTags("c1", ["ui"]);
    expect(bodyOf()).toEqual({ tags: ["ui"] });
  });

  it("stars a card", async () => {
    await api.setStarred("c1", true);
    expect(callOf().url).toBe("/api/cards/c1");
    expect(bodyOf()).toEqual({ starred: true });
  });

  it("grants and revokes a folder for every card", async () => {
    await api.allowFolder("/x");
    expect(callOf().url).toBe("/api/folders");
    expect(bodyOf()).toEqual({ folder: "/x" });
    await api.unallowFolder("/x");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("sets a card's read scope", async () => {
    await api.setReadScope("c1", "/x");
    expect(bodyOf()).toEqual({ readScope: "/x" });
  });

  it("removes a card", async () => {
    await api.remove("c1");
    expect(callOf().url).toBe("/api/cards/c1");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("sends a message, restarts, edits and schedules", async () => {
    await api.send("c1", "hello");
    expect(callOf().url).toBe("/api/cards/c1/messages");
    expect(bodyOf()).toEqual({ text: "hello" });
    await api.restart("c1");
    expect(bodyOf()).toEqual({ restart: true });
    await api.editLast("c1", "edited");
    expect(bodyOf()).toEqual({ text: "edited", edit: true });
    await api.schedule("c1", "later", 123);
    expect(callOf().url).toBe("/api/cards/c1/scheduled");
    expect(bodyOf()).toEqual({ text: "later", at: 123 });
    await api.unschedule("c1", "m1");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("answers a question and waits on one", async () => {
    await api.answer("c1", true, { q: "yes" }, "p1");
    expect(callOf().url).toBe("/api/cards/c1/permission");
    expect(bodyOf()).toEqual({ allow: true, answers: { q: "yes" }, pendingId: "p1" });
    await api.waitPermission("c1", "p1");
    expect(bodyOf()).toEqual({ wait: true, pendingId: "p1" });
    await api.putFirst("c1", "p1");
    expect(bodyOf()).toEqual({ first: true, pendingId: "p1" });
    await api.putHolderFirst("c1", "p1");
    expect(bodyOf()).toEqual({ otherFirst: true, pendingId: "p1" });
  });

  it("answers a question without answers or a reply", async () => {
    await api.answer("c1", false);
    expect(bodyOf()).toEqual({ allow: false, answers: undefined, pendingId: undefined });
  });

  it("stops a card and one of its tasks", async () => {
    await api.stop("c1");
    expect(callOf().url).toBe("/api/cards/c1/stop");
    await api.stopTask("c1", "t/1");
    expect(callOf().url).toBe("/api/cards/c1/tasks/t%2F1/stop");
  });

  it("runs a shell command in a card", async () => {
    await api.shell("c1", "ls");
    expect(callOf().url).toBe("/api/cards/c1/shell");
    expect(bodyOf()).toEqual({ command: "ls" });
  });

  it("starts a fresh session on a card", async () => {
    await api.fresh("c1", "brief");
    expect(callOf().url).toBe("/api/cards/c1/fresh");
  });

  it("releases a card's CLI session", async () => {
    await api.release("c1");
    expect(callOf().url).toBe("/api/cards/c1/release");
  });

  it("switches a card's CLI, with the replay flag and the model", async () => {
    await api.switchBackend("c1", "puku");
    expect(bodyOf()).toEqual({ backend: "puku", replay: false, model: undefined });
    await api.switchBackend("c1", "puku", true, "puku-ai-2.8");
    expect(bodyOf()).toEqual({ backend: "puku", replay: true, model: "puku-ai-2.8" });
  });

  it("reruns a card on another model", async () => {
    await api.rerunModel("c1", "claude-opus-5-5");
    expect(callOf().url).toBe("/api/cards/c1/rerun-model");
  });

  it("deletes a card", async () => {
    await api.deleteCard("c1");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("switches a column of cards at once", async () => {
    await api.switchBackends(["c1", "c2"], "codex");
    expect(callOf().url).toBe("/api/cards/switch-backend");
    expect(bodyOf()).toEqual({ ids: ["c1", "c2"], backend: "codex" });
  });

  it("reads and drives a card's dev server", async () => {
    await api.devStatus("c1");
    expect(callOf().url).toBe("/api/cards/c1/dev");
    await api.devAction("c1", "restart");
    expect(bodyOf()).toEqual({ action: "restart" });
  });
});

// A fetch that answers once with a reply or a failure.
function fetchMockOnce(answer: Response | Error): void {
  fetchMock.mockImplementationOnce(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
}
