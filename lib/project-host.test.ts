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
  create: vi.fn(),
  warm: vi.fn(),
  devAction: vi.fn(),
  updateWebhook: vi.fn(),
  removeWebhook: vi.fn(),
}));
const call = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api, call }));

const actOnWorker = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("./worker-transport", () => ({ actOnWorker, workerToolSource: "worker tools", workerTransport: { desktop: false } }));
const actOnLine = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const warmOnLine = vi.hoisted(() => vi.fn());
vi.mock("./line-host", () => ({ actOnLine, warmOnLine, lineTransport: (workerId: string) => ({ desktop: false, workerId }), lineFiles: (workerId: string) => `line files ${workerId}` }));
const filesApi = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), head: vi.fn(), write: vi.fn(), stat: vi.fn() }));
vi.mock("./client-files", () => ({ filesApi }));
const cronApi = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), run: vi.fn() }));
vi.mock("./cron-client", () => ({ cronApi }));
vi.mock("./worker-files", () => ({ workerFiles: "worker files" }));
vi.mock("./project-reads", () => ({ localRead: "local read" }));
vi.mock("./project-snapshot-view", () => ({ cloudRead: "cloud read" }));

const { cardCan, cloudHost, hostFor, hostOf, localHost, sameHostCards, setHostForEveryCard } = await import("./project-host");
const { localTransport } = await import("./thread-transport");
const { localToolSource } = await import("./use-tool-result");

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(filesApi), ...Object.values(cronApi), call]) fn.mockResolvedValue({ ok: true });
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
    expect(w1).toMatchObject({ kind: "cloud", tools: "worker tools", thread: { workerId: "w1" }, files: "line files w1", menu: cloudHost.menu });
    await w1.act("card.stop", { id: "c1" });
    expect(actOnLine).toHaveBeenCalledWith("w1", "card.stop", { id: "c1" });
    w1.warm("c1");
    expect(warmOnLine).toHaveBeenCalledWith("w1", "c1");
    cloudHost.warm("c1");
    expect(warmOnLine).toHaveBeenCalledOnce();
  });
});

describe("setHostForEveryCard", () => {
  it("answers one host for every card while set, a folder's and a worker's alike, until taken back", () => {
    const web = { ...cloudHost, kind: "cloud" as const };
    const undo = setHostForEveryCard(web);
    expect(hostFor("/Users/me/dev/weft")).toBe(web);
    expect(hostOf({ cwd: "worker://w1/app" })).toBe(web);
    undo();
    expect(hostFor("/Users/me/dev/weft")).toBe(localHost);
  });

  it("leaves a newer host in place when an older one's undo runs late", () => {
    const first = { ...cloudHost };
    const second = { ...cloudHost };
    const undoFirst = setHostForEveryCard(first);
    const undoSecond = setHostForEveryCard(second);
    undoFirst();
    expect(hostFor(null)).toBe(second);
    undoSecond();
    expect(hostFor(null)).toBe(localHost);
  });
});

describe("localHost", () => {
  it("reads and acts through this Mac's own transport and tool source, and has every feature", () => {
    expect(localHost.kind).toBe("local");
    expect(localHost.thread).toBe(localTransport);
    expect(localHost.tools).toBe(localToolSource);
    expect(localHost.can("files")).toBe(true);
    expect(localHost.can("shell")).toBe(true);
    // The badges read this Mac's routes, the editor its card routes.
    expect(localHost.read).toBe("local read");
    expect(localHost.files).toBe(filesApi);
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
    ["files.list", { id: "c1" }, filesApi.list, ["c1"]],
    ["files.read", { id: "c1", path: "a.ts" }, filesApi.read, ["c1", "a.ts"]],
    ["files.read", { id: "c1", path: "a.ts", at: "HEAD" }, filesApi.head, ["c1", "a.ts"]],
    ["files.write", { id: "c1", path: "a.ts", text: "x", baseHash: "h" }, filesApi.write, ["c1", "a.ts", "x", "h"]],
    ["card.warm", { id: "c1" }, api.warm, [{ cardId: "c1" }]],
    ["card.create", { id: "n1", prompt: "p", start: false }, api.create, [{ prompt: "p", start: false }]],
    ["dev.open", { id: "c1" }, call, ["POST", "/api/cards/c1/dev", { action: "open" }]],
    ["dev.stop", { id: "c1" }, api.devAction, ["c1", "stop"]],
    ["cron.update", { id: "k1", patch: { enabled: false } }, cronApi.update, ["k1", { enabled: false }]],
    ["cron.delete", { id: "k1" }, cronApi.remove, ["k1"]],
    ["cron.run", { id: "k1" }, cronApi.run, ["k1"]],
    ["webhook.update", { id: "h1", patch: { registered: true } }, api.updateWebhook, ["h1", { registered: true }]],
    ["webhook.delete", { id: "h1" }, api.removeWebhook, ["h1"]],
    ["dev.restart", { id: "c1" }, call, ["POST", "/api/cards/c1/dev", { action: "rerun" }]],
    ["dev.log", { id: "c1" }, call, ["POST", "/api/cards/c1/dev", { action: "log" }]],
  ] as const)("%s goes to the route the board has always called", async (verb, args, fn, expected) => {
    const run = localHost.act as (verb: string, args: unknown) => Promise<void>;
    await run(verb, args);
    expect(fn).toHaveBeenCalledWith(...expected);
  });

  it("warms a card through /api/warm, best effort", async () => {
    api.warm.mockRejectedValueOnce(new Error("down"));
    localHost.warm("c1");
    await Promise.resolve();
    expect(api.warm).toHaveBeenCalledWith({ cardId: "c1" });
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
    // The badges read the worker's snapshot, the editor its file verbs (H4).
    expect(cloudHost.read).toBe("cloud read");
    expect(cloudHost.files).toBe("worker files");
  });

  it("has Send later, the files and the header reads (H4), a skill as a message, shares its cloud rows and deletes, and none of this Mac's other features", () => {
    for (const feature of ["projectActs", "shots", "pane", "folder", "agent", "shell", "skills", "login", "vault", "dev", "cron", "settings"] as const)
      expect(cloudHost.can(feature)).toBe(false);
    for (const feature of ["schedule", "runSkill"] as const) {
      expect(cloudHost.can(feature)).toBe(true);
      expect(localHost.can(feature)).toBe(true);
    }
    for (const feature of ["share", "delete"] as const) expect(cloudHost.can(feature)).toBe(true);
    expect(cloudHost.can("files")).toBe(true);
    expect(cloudHost.can("reads")).toBe(true);
  });

  it("changes its crons and webhooks from the Mac's drawers, but makes no relay there", () => {
    expect([cloudHost.can("lists"), localHost.can("lists")]).toEqual([true, true]);
    expect([cloudHost.can("relay"), localHost.can("relay")]).toEqual([false, true]);
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

describe("cardCan", () => {
  const mac = { cwd: "/dev/weft" };
  const worker = { cwd: "worker://w1/ling" };
  const desktop = { desktop: true };
  const workerPanel = { desktop: false, cardEdits: true };
  const web = { desktop: false };

  it("is the card's host's answer where the panel reaches that host", () => {
    expect(cardCan(mac, desktop, "cron")).toBe(true);
    expect(cardCan(worker, workerPanel, "runSkill")).toBe(true);
    expect(cardCan(worker, workerPanel, "skills")).toBe(false);
  });

  it("is never on weft.zip, whose panel reaches no host's card controls", () => {
    expect(cardCan(mac, web, "skills")).toBe(false);
    expect(cardCan(worker, web, "runSkill")).toBe(false);
  });
});
