import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards: Card[] = [];

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
const devSecrets = vi.hoisted(() => vi.fn());
vi.mock("./secret-run", () => ({ devSecrets }));
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/bin" }) }));
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-devserver-list", listCards: () => cards, getCard: () => undefined }));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

const dev = await import("./devserver");
const list = await import("./devserver-list");

// Fakes for the spawn children (lib/devserver.test.ts does the same; only stdout/stderr/exit matter here).
class FakeChild {
  stdout = { on: vi.fn() };
  stderr = { on: vi.fn() };
  on = vi.fn();
  kill = vi.fn();
  pid = 1000;
}

beforeEach(() => {
  for (const id of ["a", "b", "c"]) dev.stopDev(id);
  cards.length = 0;
  fetchMock.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
  spawn.mockReset().mockImplementation(() => new FakeChild());
  devSecrets.mockReset().mockResolvedValue({});
  kill.mockClear();
});
afterEach(() => {
  for (const id of ["a", "b", "c"]) dev.stopDev(id);
  cards.length = 0;
});

describe("parseUrl", () => {
  it("reads localhost:N, port N, and on port N", () => {
    expect(list.parseUrl("npm run dev (localhost:3000)")).toBe("http://localhost:3000");
    expect(list.parseUrl("vite on port 5173")).toBe("http://localhost:5173");
    expect(list.parseUrl("next dev --port 4001")).toBe("http://localhost:4001");
  });
  it("returns an http url when one is in the description", () => {
    expect(list.parseUrl("ready at http://localhost:9000/health")).toBe("http://localhost:9000/health");
  });
  it("returns undefined when there's no port or url", () => {
    expect(list.parseUrl("npm test")).toBeUndefined();
    expect(list.parseUrl("PORT=abc npm run dev")).toBeUndefined();
  });
});

describe("findDev", () => {
  it("returns the card id and run when one matches the cwd and command, not exited", async () => {
    await dev.startDev("a", "npm run dev", "/proj", "A");
    const found = list.findDev("/proj", "npm run dev");
    expect(found?.cardId).toBe("a");
    expect(found?.run.command).toBe("npm run dev");
  });

  it("skips exited runs and ones with a different command or cwd", async () => {
    await dev.startDev("a", "npm run dev", "/proj", "A");
    await dev.startDev("b", "pnpm dev", "/proj", "B");
    expect(list.findDev("/proj", "next dev")).toBeUndefined();
    expect(list.findDev("/other", "npm run dev")).toBeUndefined();
  });
});

describe("listDev", () => {
  it("includes Weft runs with their state, then thread dev-server tasks, newest first", async () => {
    // The thread task was started first; the Weft run came later.
    cards.push({ id: "t1", title: "T1", cwd: "/proj2", tasks: [{ id: "tk1", kind: "shell", description: "next dev on port 4001", background: true, status: "running", startedAt: 5 }] } as Card);
    await dev.startDev("a", "npm run dev", "/proj", "A", "http://localhost:3000");
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const all = await list.listDev();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ source: "weft", cardId: "a", title: "A", cwd: "/proj", command: "npm run dev", url: "http://localhost:3000" });
    expect(all[0]?.state).toBe("running");
    expect(all[1]).toMatchObject({ source: "thread", cardId: "t1", command: "next dev on port 4001", url: "http://localhost:4001", state: "running", taskId: "tk1" });
  });

  it("reads a Weft run with no url as running until it exits", async () => {
    await dev.startDev("a", "npm run dev", "/proj", "A");
    expect((await list.listDev())[0]?.state).toBe("running");
  });

  it("skips cards with no tasks and leaves out a title the card doesn't have", async () => {
    cards.push({ id: "none", cwd: "/x" } as Card, { id: "t2", cwd: "/p", tasks: [{ id: "k", kind: "shell", description: "pnpm dev", background: true, status: "running", startedAt: 1 }] } as Card);
    const all = await list.listDev();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBeUndefined();
    expect(all[0]?.url).toBeUndefined();
  });

  it("skips thread tasks that aren't background shell, aren't running, or don't look like dev servers", async () => {
    cards.push({ id: "t1", cwd: "/p", tasks: [
      { id: "fg", kind: "shell", description: "next dev", background: false, status: "running", startedAt: 1 },
      { id: "done", kind: "shell", description: "vite", background: true, status: "completed", startedAt: 2 },
      { id: "agent", kind: "agent", description: "Explore", background: true, status: "running", startedAt: 3 },
      { id: "plain", kind: "shell", description: "npm test", background: true, status: "running", startedAt: 4 },
      { id: "ok", kind: "shell", description: "next dev on port 4001", background: true, status: "running", startedAt: 5 },
    ] } as Card);
    const all = await list.listDev();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ taskId: "ok", command: "next dev on port 4001" });
  });
});
