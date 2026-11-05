import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLOSED_LINE } from "./card-resume";
import type { Card, ThreadItem } from "./types";
import { recoverCards, STOPPED_NOTE } from "./worker-recover";

const card = (id: string, over: Partial<Card> = {}): Card =>
  ({ id, title: id, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

const asked: ThreadItem = { kind: "permission", id: "p1", toolName: "Bash", title: "Run ls", at: 1 };

function fakeStore(cards: Card[], threads: Record<string, ThreadItem[]> = {}) {
  const thread = (id: string) => (threads[id] ??= []);
  return {
    threads,
    listCards: () => cards,
    getThread: thread,
    replaceThreadItem: (id: string, index: number, item: ThreadItem) => void (thread(id)[index] = item),
    appendThread: (id: string, item: ThreadItem) => thread(id).push(item) - 1,
  };
}

describe("recoverCards on the real store", () => {
  it("finds what a dead daemon left, and the bus hears the closed request", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-recover-"));
    const base = { prompt: "p", cwd: "/", backend: "claude", createdAt: 1, updatedAt: 1, sessionId: "s" };
    fs.mkdirSync(path.join(dir, "threads"));
    fs.writeFileSync(
      path.join(dir, "board.json"),
      JSON.stringify({ cards: [{ ...base, id: "ran", title: "r", column: "running" }, { ...base, id: "asked", title: "a", column: "needs_you", pending: { id: "p1" } }] }),
    );
    fs.writeFileSync(path.join(dir, "threads", "asked.json"), JSON.stringify([asked]));
    vi.resetModules();
    vi.stubEnv("WEFT_DATA", dir);
    delete (globalThis as { __weftState?: unknown }).__weftState;
    const store = await import("./store");
    const { subscribe } = await import("./bus");
    const heard: number[] = [];
    subscribe((e) => {
      if (e.type === "thread") heard.push(e.index);
    });
    expect(recoverCards(store).cut.sort()).toEqual(["asked", "ran"]);
    expect(store.getCard("ran")).toMatchObject({ column: "review", lastLine: CLOSED_LINE, interrupted: true });
    expect(store.getCard("asked")).toMatchObject({ column: "review", pending: null });
    expect(store.getThread("asked")[0]).toMatchObject({ decision: "deny" });
    expect(heard).toEqual([0]);
    vi.unstubAllEnvs();
    delete (globalThis as { __weftState?: unknown }).__weftState;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("recoverCards", () => {
  it("sends a cut-off card's whole thread and a stopped card's row, and leaves the rest", () => {
    const store = fakeStore([
      card("cut", { interrupted: true, sessionId: "s", lastLine: CLOSED_LINE }),
      card("capped", { lastLine: CLOSED_LINE, resumes: 3 }),
      card("fine", { lastLine: "All done" }),
      card("copilot", { role: "copilot", interrupted: true }),
    ]);
    expect(recoverCards(store)).toEqual({ cut: ["cut"], stopped: ["capped"] });
  });

  it("closes a request nobody can answer and keeps a decided one", () => {
    const decided: ThreadItem = { kind: "permission", id: "p0", toolName: "Bash", title: "Run ls", decision: "allow", at: 1 };
    const store = fakeStore([card("a", { interrupted: true, sessionId: "s" })], { a: [decided, asked] });
    recoverCards(store);
    expect(store.threads.a).toEqual([decided, { ...asked, decision: "deny" }]);
  });

  it("leaves the note to lib/resume.ts on a card it will carry on", () => {
    const store = fakeStore([card("a", { interrupted: true, sessionId: "s" })]);
    recoverCards(store);
    expect(store.threads.a ?? []).toEqual([]);
  });

  it("says so in a thread that stays stopped, once across restarts", () => {
    const store = fakeStore([
      card("no-session", { interrupted: true }),
      card("filed", { interrupted: true, sessionId: "s", archived: true }),
      card("capped", { lastLine: CLOSED_LINE, sessionId: "s", resumes: 3 }),
    ]);
    recoverCards(store);
    recoverCards(store);
    for (const id of ["no-session", "filed", "capped"]) {
      expect(store.threads[id]).toEqual([{ kind: "notification", status: "stopped", summary: STOPPED_NOTE, at: expect.any(Number) as number }]);
    }
  });
});
