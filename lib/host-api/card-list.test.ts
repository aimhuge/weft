// card.list against a real store in a temp folder: the board's cards without the copilot, and each worktree folder's
// main repo (a project's folder too).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listProjects = vi.hoisted(() => vi.fn(() => [{ path: "/proj-wt" }]));
vi.mock("../settings", () => ({ listProjects }));
vi.mock("../repos", () => ({ projectRoot: (cwd: string) => cwd.replace(/-wt$/, "") }));

let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-card-list-"));
  process.env.WEFT_DATA = dir;
  vi.resetModules();
  delete g.__weftState;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("card.list", () => {
  it("lists the cards but the copilot, with the worktree roots", async () => {
    const store = await import("../store");
    const { listCardsVerb } = await import("./card-list");
    store.createCard({ title: "a", prompt: "p", cwd: "/repo-wt", backend: "claude", permissionMode: "default" }, "a");
    store.createCard({ title: "b", prompt: "p", cwd: "/repo", backend: "claude", permissionMode: "default" }, "b");
    store.createCard({ title: "co", prompt: "p", cwd: "/home", backend: "claude", permissionMode: "default", role: "copilot" }, "co");
    const { cards, roots } = await listCardsVerb();
    expect(cards.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(roots).toEqual({ "/repo-wt": "/repo", "/proj-wt": "/proj" });
  });
});
