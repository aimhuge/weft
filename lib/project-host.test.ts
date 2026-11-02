// A project's host (lib/project-host.ts): this Mac's card routes through the api client, a worker's through a `host`
// command, and the board asking hostFor rather than whether a path is a worker's.
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  stop: vi.fn(),
  remove: vi.fn(),
  shell: vi.fn(),
  fresh: vi.fn(),
  send: vi.fn(),
  editLast: vi.fn(),
  restart: vi.fn(),
  answer: vi.fn(),
  waitPermission: vi.fn(),
  putFirst: vi.fn(),
  putHolderFirst: vi.fn(),
  switchBackend: vi.fn(),
  rerunModel: vi.fn(),
  stopTask: vi.fn(),
  schedule: vi.fn(),
  unschedule: vi.fn(),
}));
const call = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api, call }));

const actOnWorker = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("./worker-transport", () => ({ actOnWorker, workerToolSource: "worker tools", workerTransport: { desktop: false } }));
const actOnLine = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("./line-host", () => ({ actOnLine, lineTransport: (workerId: string) => ({ desktop: false, workerId }) }));

const { cloudHost, hostFor, hostOf, localHost, sameHostCards } = await import("./project-host");
const { localTransport } = await import("./thread-transport");
const { localToolSource } = await import("./use-tool-result");

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [...Object.values(api), call]) fn.mockResolvedValue({ ok: true });
});

describe("hostFor", () => {
  it("is this Mac for a folder, no project or a card in one", () => {
    expect(hostFor("/Users/me/dev/weft")).toBe(localHost);
    expect(hostFor(null)).toBe(localHost);
    expect(hostFor(undefined)).toBe(localHost);
    expect(hostOf({ cwd: "/r" })).toBe(localHost);
  });

  it("is that worker's host for a worker:// project and its cards, one per worker, on its session line's route", async () => {
    const w1 = hostFor("worker://w1/ling");
    expect(hostOf({ cwd: "worker://w1/app" })).toBe(w1);
    expect(hostFor("worker://w2/ling")).not.toBe(w1);
    expect(w1).toMatchObject({ kind: "cloud", tools: "worker tools", thread: { workerId: "w1" }, menu: cloudHost.menu });
    await w1.act("card.stop", { id: "c1" });
    expect(actOnLine).toHaveBeenCalledWith("w1", "card.stop", { id: "c1" });
  });
});

describe("localHost", () => {
  it("reads and acts through this Mac's own transport and tool source, and has every feature", () => {
    expect(localHost.kind).toBe("local");
    expect(localHost.thread).toBe(localTransport);
    expect(localHost.tools).toBe(localToolSource);
    expect(localHost.can("files")).toBe(true);
    expect(localHost.can("shell")).toBe(true);
  });

  it("keeps the whole menu", () => {
    const items = [{ id: "delete", label: "Delete…" }];
    expect(localHost.menu(items)).toBe(items);
  });

  it("runs a caller's own call when it has one", async () => {
    const local = vi.fn(() => Promise.resolve("done"));
    await localHost.act("card.update", { id: "c1", body: { starred: true } }, local);
    expect(local).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
  });

  it("sends a card update to the card's PATCH route", async () => {
    await localHost.act("card.update", { id: "c1", body: { title: "New" } });
    expect(call).toHaveBeenCalledWith("PATCH", "/api/cards/c1", { title: "New" });
  });

  it.each([
    ["card.stop", { id: "c1" }, api.stop, ["c1"]],
    ["card.delete", { id: "c1" }, api.remove, ["c1"]],
    ["card.shell", { id: "c1", command: "ls" }, api.shell, ["c1", "ls"]],
    ["card.shell", { id: "c1" }, api.shell, ["c1", ""]],
    ["card.fresh", { id: "c1", message: "go" }, api.fresh, ["c1", "go"]],
    ["card.message", { id: "c1", text: "hi" }, api.send, ["c1", "hi"]],
    ["card.message.edit", { id: "c1", text: "hi again" }, api.editLast, ["c1", "hi again"]],
    ["card.restart", { id: "c1" }, api.restart, ["c1"]],
    ["card.permission.answer", { id: "c1", allow: true, pendingId: "p1" }, api.answer, ["c1", true, undefined, "p1", undefined]],
    ["card.permission.answer", { id: "c1", allow: "yes", answers: { q: "a" }, reply: { notes: "n" } }, api.answer, ["c1", false, { q: "a" }, undefined, { notes: "n" }]],
    ["card.permission.wait", { id: "c1", pendingId: "p1" }, api.waitPermission, ["c1", "p1"]],
    ["card.permission.first", { id: "c1", pendingId: "p1" }, api.putFirst, ["c1", "p1"]],
    ["card.permission.otherFirst", { id: "c1", pendingId: "p1" }, api.putHolderFirst, ["c1", "p1"]],
    ["card.switchBackend", { id: "c1", backend: "codex" }, api.switchBackend, ["c1", "codex"]],
    ["card.switchBackend", { id: "c1", backend: "codex", replay: true }, api.switchBackend, ["c1", "codex", true]],
    ["card.switchBackend", { id: "c1", backend: "claude", replay: false, model: "opus" }, api.switchBackend, ["c1", "claude", false, "opus"]],
    ["card.rerunModel", { id: "c1", model: "sonnet" }, api.rerunModel, ["c1", "sonnet"]],
    ["card.stopTask", { id: "c1", taskId: "t1" }, api.stopTask, ["c1", "t1"]],
    ["card.schedule", { id: "c1", text: "later", at: "5000" }, api.schedule, ["c1", "later", 5000]],
    ["card.unschedule", { id: "c1", messageId: "m1" }, api.unschedule, ["c1", "m1"]],
    ["skills.list", { id: "c 1" }, call, ["GET", "/api/skills?card=c%201"]],
  ] as const)("%s goes to the route the board has always called", async (verb, args, fn, expected) => {
    const run = localHost.act as (verb: string, args: unknown) => Promise<void>;
    await run(verb, args);
    expect(fn).toHaveBeenCalledWith(...expected);
  });

  it("rejects with the route's refusal", async () => {
    api.stop.mockRejectedValueOnce(new Error("busy"));
    await expect(localHost.act("card.stop", { id: "c1" })).rejects.toThrow("busy");
  });
});

describe("cloudHost", () => {
  it("reads through the worker transport and tool source", () => {
    expect(cloudHost.kind).toBe("cloud");
    expect(cloudHost.thread).toEqual({ desktop: false });
    expect(cloudHost.tools).toBe("worker tools");
  });

  it("has none of this Mac's own features, but holds Send later's timer, shares its cloud rows and deletes", () => {
    for (const feature of ["files", "shots", "pane", "folder", "agent", "shell", "skills", "login", "vault", "dev"] as const)
      expect(cloudHost.can(feature)).toBe(false);
    for (const feature of ["schedule", "share", "delete"] as const) expect(cloudHost.can(feature)).toBe(true);
    expect(localHost.can("schedule")).toBe(true);
  });

  it("sends every verb to the worker, never the local call", async () => {
    const local = vi.fn(() => Promise.resolve());
    await cloudHost.act("card.update", { id: "c1", body: { starred: true } }, local);
    expect(actOnWorker).toHaveBeenCalledWith("card.update", { id: "c1", body: { starred: true } });
    expect(local).not.toHaveBeenCalled();
  });

  it("trims the menu to what a worker backs", () => {
    expect(cloudHost.menu([{ id: "rename", label: "Rename…" }, { id: "reveal", label: "Reveal" }, { id: "delete", label: "Delete…" }])).toEqual([
      { id: "rename", label: "Rename…" },
      { id: "delete", label: "Delete…" },
    ]);
  });
});

describe("sameHostCards", () => {
  const mac = { cwd: "/dev/app" };
  const w1 = { cwd: "worker://w1/app" };
  const w1b = { cwd: "worker://w1/site" };
  const w2 = { cwd: "worker://w2/app" };
  const all = [mac, w1, w1b, w2] as Parameters<typeof sameHostCards>[0];

  it("is every card for one of this Mac's, as before", () => {
    expect(sameHostCards(all, mac)).toBe(all);
  });

  it("is only that worker's cards for a worker's", () => {
    expect(sameHostCards(all, w1)).toEqual([w1, w1b]);
    expect(sameHostCards(all, w2)).toEqual([w2]);
  });
});
