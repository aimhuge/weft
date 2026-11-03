import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

// The board tools on this Mac over every host (lib/board-tools-hosts.ts): this Mac's store is a fake, the workers are a
// fake WorkerReach (lib/board-tools.harness.ts fakeReach).
const store = vi.hoisted(() => ({ cards: new Map<string, Card>(), threads: new Map<string, ThreadItem[]>() }));
// Each project's default agent on this Mac (Settings → Agents), by board path.
const defaults = vi.hoisted(() => {
  const projects: Record<string, string> = {};
  return { projects };
});
vi.mock("./agent-store", async () => {
  const { BUILT_IN_AGENTS } = await import("./agents");
  return { listAgents: () => BUILT_IN_AGENTS, projectAgent: (cwd: string) => defaults.projects[cwd] };
});
vi.mock("./store", () => ({
  getCard: (id: string) => store.cards.get(id),
  getThread: (id: string) => store.threads.get(id) ?? [],
  listCards: () => [...store.cards.values()],
}));

const { fakeReach } = await import("./board-tools.harness");
const { WORKER_THREAD_MAX, actOnHostCard, createWorkerCard, findHostCard, hostListText, hostThreadText, workerFolder } = await import("./board-tools-hosts");
const { workerProjectPath } = await import("./worker-project");

const APP = workerProjectPath("w1", "app");
const card = (over: Partial<Card>): Card => ({ id: "c1", title: "Here", prompt: "p", cwd: "/dev/weft", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 1, ...over });
const workerCard = card({ id: "w1c", title: "There", cwd: APP, column: "running", updatedAt: 2 });
const said = (n: number): ThreadItem => ({ kind: "assistant", text: `line ${n}` }) as ThreadItem;
let reach: ReturnType<typeof fakeReach>;

async function inEmptyDir(run: (dir: string) => Promise<void>) {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-hosts-"));
  process.chdir(dir);
  try {
    await run(dir);
  } finally {
    process.chdir(cwd);
  }
}

beforeEach(() => {
  store.cards.clear();
  store.threads.clear();
  store.cards.set("c1", card({}));
  reach = fakeReach();
  reach.board.mockResolvedValue({ cards: [workerCard], projects: [{ path: APP, workerId: "w1", worker: "m1mini", folder: "app", status: "online" }] });
});

describe("hostListText", () => {
  it("lists this Mac's cards and the workers' together, newest first", async () => {
    const text = await hostListText({}, reach);
    expect(text.split("\n").map((l) => l.split(" | ")[0])).toEqual(["w1c", "c1"]);
    expect(text).toContain(APP);
  });

  it("answers with this Mac's cards and says why when the workers can't be read", async () => {
    reach.board.mockRejectedValue(new Error("Sign in to Weft to reach your worker."));
    const text = await hostListText({}, reach);
    expect(text).toContain("c1 | review");
    expect(text).toContain("Your Weft Workers' cards couldn't be read (Sign in to Weft to reach your worker.); these are this Mac's.");
  });

  it("gives up on a board read that hangs", async () => {
    vi.useFakeTimers();
    try {
      reach.board.mockReturnValue(new Promise(() => {}));
      const text = hostListText({}, reach);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await text).toContain("they didn't answer in time");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a thrown non-Error as its text", async () => {
    reach.board.mockRejectedValue("offline");
    expect(await hostListText({}, reach)).toContain("(offline)");
  });
});

describe("findHostCard", () => {
  it("finds this Mac's card without asking the workers", async () => {
    expect(await findHostCard("c1", reach)).toEqual({ card: store.cards.get("c1"), worker: false });
    expect(reach.board).not.toHaveBeenCalled();
  });

  it("finds a worker's card on the workers' board", async () => {
    expect(await findHostCard("w1c", reach)).toEqual({ card: workerCard, worker: true });
  });

  it("refuses the copilot and an id no host has", async () => {
    store.cards.set("copilot", card({ id: "copilot", role: "copilot" }));
    await expect(findHostCard("copilot", reach)).rejects.toThrow("No card copilot. Use list_cards to get card ids.");
    await expect(findHostCard("nope", reach)).rejects.toThrow("No card nope.");
  });
});

describe("hostThreadText", () => {
  it("reads this Mac's card from the store", async () => {
    store.threads.set("c1", [said(1)]);
    expect(await hostThreadText("c1", undefined, reach)).toContain("AGENT: line 1");
    expect(reach.page).not.toHaveBeenCalled();
  });

  it("walks a worker card's synced pages back to the last N items", async () => {
    reach.page.mockImplementation((_id, before) =>
      Promise.resolve(before === undefined ? { items: [said(3), said(4)], start: 2, total: 4 } : { items: [said(0), said(1)], start: 0, total: 4 }),
    );
    const text = await hostThreadText("w1c", 3, reach);
    expect(text).toContain(`folder: ${APP}`);
    expect(text).not.toContain("line 0");
    expect(text).toContain("AGENT: line 1\n\nAGENT: line 3\n\nAGENT: line 4");
    expect(reach.page.mock.calls).toEqual([["w1c", undefined], ["w1c", 2]]);
  });

  it("stops at an empty page, and keeps what it read when an older page fails", async () => {
    reach.page.mockResolvedValueOnce({ items: [], start: 5, total: 5 });
    expect(await hostThreadText("w1c", undefined, reach)).toContain("(empty thread)");
    reach.page.mockResolvedValueOnce({ items: [said(9)], start: 9, total: 10 }).mockResolvedValueOnce(null);
    expect(await hostThreadText("w1c", 5, reach)).toContain("AGENT: line 9");
  });

  it("says so when the thread can't be read, and caps how far back it walks", async () => {
    await expect(hostThreadText("w1c", undefined, reach)).rejects.toThrow("That worker card's thread can't be read right now.");
    const many = Array.from({ length: WORKER_THREAD_MAX + 50 }, (_, i) => said(i));
    reach.page.mockResolvedValue({ items: many, start: 1, total: many.length + 1 });
    const text = await hostThreadText("w1c", 10_000, reach);
    expect(text.match(/AGENT:/g)).toHaveLength(WORKER_THREAD_MAX);
  });
});

describe("actOnHostCard", () => {
  it("sends the verb and says when the worker hasn't taken it", async () => {
    expect(await actOnHostCard(workerCard, "card.stop", {}, reach)).toBe("");
    expect(reach.act).toHaveBeenCalledWith("w1c", "card.stop", {});
    reach.act.mockResolvedValue({ queued: true });
    expect(await actOnHostCard(workerCard, "card.stop", {}, reach)).toContain("once that worker is back");
  });
});

describe("workerFolder", () => {
  it("takes a worker:// path as it is", async () => {
    expect(await workerFolder(` ${APP} `, reach)).toBe(APP);
    expect(reach.board).not.toHaveBeenCalled();
  });

  it("leaves paths, empty folders and names this Mac has to this Mac", async () => {
    await inEmptyDir(async (here) => {
      fs.mkdirSync(path.join(here, "app"));
      expect(await workerFolder("app", reach)).toBeNull();
    });
    for (const f of ["", "/dev/app", "~/app", "a\\b"]) expect(await workerFolder(f, reach)).toBeNull();
    expect(reach.board).not.toHaveBeenCalled();
  });

  it("finds a name only a worker project has, and asks which when two do", async () => {
    // A bare name resolves against the server's own folder first, so these run in an empty one.
    await inEmptyDir(async () => {
      expect(await workerFolder("app", reach)).toBe(APP);
      expect(await workerFolder("other", reach)).toBeNull();
      const two = workerProjectPath("w2", "app");
      reach.board.mockResolvedValue({ cards: [], projects: [{ path: APP, workerId: "w1", worker: "a", folder: "app", status: "online" }, { path: two, workerId: "w2", worker: "b", folder: "app", status: "online" }] });
      await expect(workerFolder("app", reach)).rejects.toThrow(`More than one worker has a project named app: ${APP}, ${two}. Pass one of those.`);
    });
  });
});

describe("createWorkerCard", () => {
  it("starts it on the worker in default mode, with only what was given", async () => {
    const text = await createWorkerCard({ folder: APP, prompt: "Fix it", title: "T", tags: ["bug"], cli: "codex" }, reach);
    expect(reach.start).toHaveBeenCalledWith({ cwd: APP, prompt: "Fix it", title: "T", tags: ["bug"], backend: "codex", permissionMode: "default", start: true });
    expect(text).toMatch(/^Created and started w-\d+ on m1mini \(.+\), in default mode: it asks before edits and commands\. It runs as Builder \(builder\), that project's default agent\.$/);
  });

  it("leaves it in the worker's Backlog when asked", async () => {
    expect(await createWorkerCard({ folder: APP, prompt: "Later", start: false }, reach)).toMatch(/^Created w-\d+ in Backlog on m1mini/);
    expect(reach.start.mock.calls[0]?.[0]).toMatchObject({ start: false });
  });

  it("refuses an agent that isn't the project's default: only Weft's own window signs one", async () => {
    await expect(createWorkerCard({ folder: APP, prompt: "Write", agent: "copywriter" }, reach)).rejects.toThrow(/starts new threads as Builder \(builder\).*only Weft's own window makes/);
    expect(reach.start).not.toHaveBeenCalled();
  });

  it("takes the project's default by name and sends no agent: the worker fills it from the signed setting", async () => {
    defaults.projects[APP] = "copywriter";
    const text = await createWorkerCard({ folder: APP, prompt: "Write", agent: "copywriter" }, reach);
    expect(reach.start.mock.calls[0]?.[0]).not.toHaveProperty("agent");
    expect(text).toMatch(/It runs as Copywriter \(copywriter\), that project's default agent\.$/);
    defaults.projects = {};
  });
});
