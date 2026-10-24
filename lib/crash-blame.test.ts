import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";
import type { WeftProcess } from "./restart-guard";

const DIR = "/Users/me/dev/weft";
const WEFT: WeftProcess = { pids: [4242], port: "1024", dir: DIR, names: ["node"], lines: [] };

const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();
vi.mock("./store", () => ({
  DATA_DIR: "/tmp/weft-crash-blame-test",
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => {
    const next = { ...cards.get(id)!, ...patch };
    cards.set(id, next);
    return next;
  },
}));
vi.mock("./restart-guard", async (real) => ({ ...(await real<typeof import("./restart-guard")>()), weftProcess: () => WEFT }));

const blame = await import("./crash-blame");

const T = 1_800_000_000_000;
let seq = 0;
const tool = (name: string, summary: string, at: number, extra: Partial<Extract<ThreadItem, { kind: "tool" }>> = {}): ThreadItem => ({
  kind: "tool",
  id: `t${++seq}`,
  name,
  summary,
  at,
  ...extra,
});
const card = (id: string, items: ThreadItem[], extra: Partial<Card> = {}) => {
  cards.set(id, { id, title: id, cwd: DIR, column: "running", updatedAt: 0, createdAt: 0, ...extra } as Card);
  threads.set(id, items);
};

beforeEach(() => {
  cards.clear();
  threads.clear();
});

describe("suspicion", () => {
  const server = { kind: "server" as const, at: T };
  it("names a command that stops Weft, from Bash or the devservers tool", () => {
    const hit = blame.suspicion(tool("mcp__devservers__start", "pnpm dev", T) as never, DIR, server, WEFT);
    expect(hit?.score).toBe(3);
    expect(hit?.why).toContain("`pnpm dev` stopped Weft");
    expect(blame.suspicion(tool("Bash", "kill 4242", T) as never, "/elsewhere", server, WEFT)?.score).toBe(3);
    expect(blame.suspicion(tool("Bash", "lsof -ti:1024 | xargs kill…", T) as never, "/elsewhere", server, WEFT)?.score).toBe(3);
  });
  it("lets a refused, harmless or empty command go", () => {
    expect(blame.suspicion(tool("Bash", "pnpm dev", T, { isError: true }) as never, DIR, server, WEFT)).toBeNull();
    expect(blame.suspicion(tool("Bash", "pnpm test", T) as never, DIR, server, WEFT)).toBeNull();
    expect(blame.suspicion(tool("Bash", "", T) as never, DIR, server, WEFT)).toBeNull();
    expect(blame.suspicion(tool("Read", "a.ts", T, { file: "a.ts" }) as never, DIR, server, WEFT)).toBeNull();
    expect(blame.suspicion(tool("Edit", "a.ts", T) as never, DIR, server, WEFT)).toBeNull();
  });
  it("names the edit to the file that doesn't build", () => {
    const build = { kind: "build" as const, at: T, file: "./components/Board.tsx (10:2)" };
    expect(blame.suspicion(tool("Edit", "x", T, { file: "components/Board.tsx" }) as never, DIR, build, WEFT)).toEqual({
      score: 2,
      why: "its edit to components/Board.tsx doesn't build",
      file: "components/Board.tsx",
    });
    expect(blame.suspicion(tool("Edit", "x", T, { file: "components/Other.tsx" }) as never, DIR, build, WEFT)).toBeNull();
    expect(blame.suspicion(tool("Edit", "x", T, { file: "components/Board.tsx" }) as never, DIR, { kind: "build", at: T }, WEFT)).toBeNull();
  });
  it("doesn't blame an edit for a reload or a server stop: being near one proves nothing", () => {
    const edit = tool("Write", "x", T, { file: "lib/a.ts" }) as never;
    expect(blame.suspicion(edit, DIR, { kind: "reload", at: T }, WEFT)).toBeNull();
    expect(blame.suspicion(edit, DIR, server, WEFT)).toBeNull();
    expect(blame.suspicion(tool("Bash", "kill 4242", T) as never, DIR, { kind: "reload", at: T }, WEFT)?.score).toBe(3);
  });
});

describe("overlayFile", () => {
  it("drops the line and column the overlay adds", () => {
    expect(blame.overlayFile("./lib/a.ts (1:2)", DIR)).toBe(`${DIR}/lib/a.ts`);
    expect(blame.overlayFile("./lib/a.ts", DIR)).toBe(`${DIR}/lib/a.ts`);
  });
});

describe("blame", () => {
  it("picks the strongest suspect in the window, the latest of equals", () => {
    card("editor", [tool("Edit", "x", T - 2000, { file: "lib/a.ts" })]);
    card("killer", [tool("Bash", "pnpm dev", T - 3000), tool("Read", "y", T - 1000)]);
    card("late", [tool("Bash", "pnpm dev", T - 1000)]);
    expect(blame.blame([...cards.values()], (id) => threads.get(id)!, { kind: "reload", at: T }, WEFT)).toMatchObject({ cardId: "late", score: 3 });
  });
  it("looks only at the window, open cards with a folder, and tool items", () => {
    card("old", [tool("Bash", "pnpm dev", T - 60_000)]);
    card("future", [tool("Bash", "pnpm dev", T + 5000)]);
    card("archived", [tool("Bash", "pnpm dev", T)], { archived: true });
    card("nowhere", [tool("Bash", "pnpm dev", T)], { cwd: "" });
    card("talk", [{ kind: "assistant", text: "hi", at: T }]);
    expect(blame.blame([...cards.values()], (id) => threads.get(id)!, { kind: "server", at: T }, WEFT)).toBeNull();
  });
});

describe("nextBreak", () => {
  const suspect = { cardId: "c", at: T, score: 3, why: "w", file: "a.ts" };
  it("starts a mark, counts a repeat and skips a second report of the same incident", () => {
    const first = blame.nextBreak(undefined, { kind: "server", at: T }, suspect);
    expect(first).toEqual({ kind: "server", at: T, why: "w", file: "a.ts" });
    expect(blame.nextBreak(first, { kind: "server", at: T + 10_000 }, suspect)).toBeUndefined();
    expect(blame.nextBreak(first, { kind: "server", at: T + 120_000 }, suspect)).toMatchObject({ times: 2 });
    expect(blame.nextBreak({ ...first!, times: 2 }, { kind: "reload", at: T + 1 }, { ...suspect, file: undefined })).toEqual({ kind: "reload", at: T + 1, why: "w", times: 3 });
  });
});

describe("recordBreak", () => {
  it("marks the card, then folds the board's reload into the same incident", () => {
    card("killer", [tool("mcp__devservers__start", "pnpm dev", T - 1000)]);
    card("editor", [tool("Edit", "x", T + 2000, { file: "lib/a.ts" })]);
    expect(blame.recordBreak({ kind: "server", at: T })?.broke).toMatchObject({ kind: "server", at: T });
    expect(blame.recordBreak({ kind: "reload", at: T + 3000 })).toBeUndefined();
    expect(cards.get("editor")?.broke).toBeUndefined();
    // The same report again changes nothing.
    expect(blame.recordBreak({ kind: "server", at: T + 1000 })?.broke).toMatchObject({ at: T });
  });
  it("marks the card whose edit doesn't build", () => {
    card("editor", [tool("Edit", "x", T + 2_000_000, { file: "lib/a.ts" })]);
    expect(blame.recordBreak({ kind: "build", at: T + 2_001_000, file: "./lib/a.ts (3:1)" }, WEFT)?.broke).toMatchObject({ kind: "build", file: "lib/a.ts" });
  });
  it("marks nobody when nothing explains it", () => {
    card("quiet", [tool("Read", "a.ts", T)]);
    expect(blame.recordBreak({ kind: "reload", at: T + 500_000 }, WEFT)).toBeUndefined();
  });
});

describe("consumeServerExit", () => {
  const file = path.join(os.tmpdir(), `weft-server-exit-${process.pid}.json`);
  it("blames the exit once and removes the note", () => {
    card("killer", [tool("Bash", "pnpm dev", T + 900_000)]);
    fs.writeFileSync(file, JSON.stringify({ at: T + 901_000, code: 143 }));
    expect(blame.consumeServerExit(file)?.id).toBe("killer");
    expect(fs.existsSync(file)).toBe(false);
    expect(blame.consumeServerExit(file)).toBeUndefined();
  });
  it("ignores a note without a time", () => {
    fs.writeFileSync(file, JSON.stringify({ code: 143 }));
    expect(blame.consumeServerExit(file)).toBeUndefined();
  });
  it("reads ~/.weft/server-exit.json by default", () => {
    expect(blame.SERVER_EXIT_FILE()).toBe("/tmp/weft-crash-blame-test/server-exit.json");
    expect(blame.consumeServerExit()).toBeUndefined();
  });
});

describe("takeBreakNote", () => {
  it("tells the thread once, with what it did and how not to", () => {
    card("c", [], { broke: { kind: "server", at: T, why: "its `pnpm dev` stopped Weft (x)", times: 3 } });
    const note = blame.takeBreakNote("c");
    expect(note).toContain("Weft's server stopped (3 times so far): its `pnpm dev` stopped Weft (x).");
    expect(note).toContain("mcp__board__restart_weft_when_idle");
    expect(cards.get("c")?.broke?.told).toBe(true);
    expect(blame.takeBreakNote("c")).toBe("");
    expect(blame.takeBreakNote("missing")).toBe("");
  });
  it("words a build error and a reload", () => {
    card("b", [], { broke: { kind: "build", at: T, why: "w" } });
    expect(blame.takeBreakNote("b")).toContain("Weft stopped building: w.");
    card("r", [], { broke: { kind: "reload", at: T, why: "w" } });
    expect(blame.takeBreakNote("r")).toContain("Weft's board reloaded: w.");
  });
});
