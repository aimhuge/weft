// "Run on Worker" through the API: app/api/workers/route.ts switches a project to your worker and back, and
// app/api/cards/route.ts sends a new card in such a project to the worker instead of starting it here.
// The guard, the store and the engine are mocked; lib/worker-handoff.test.ts covers the hand-off itself.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  guard: () => null,
  elevated: () => null,
  fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }),
}));
const folders = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/lib/settings", () => ({
  listProjects: () => [],
  workerFolders: () => [...folders.list],
  setWorkerFolder: vi.fn((folder: string, on: boolean) => {
    folders.list = on ? [folder] : [];
  }),
}));
const handoff = vi.hoisted(() => ({
  runsOnWorker: vi.fn(() => false),
  handOffToWorker: vi.fn(() => Promise.resolve({ started: false, worker: "m1mini" })),
  requireWorker: vi.fn(() => Promise.resolve({ name: "m1mini" })),
}));
vi.mock("@/lib/worker-handoff", () => handoff);
const account = vi.hoisted(() => ({
  enrolToken: vi.fn(),
  listWorkers: vi.fn(() => Promise.reject(new Error("no Supabase here"))),
  removeWorker: vi.fn(),
  sendRun: vi.fn(),
  sendLogin: vi.fn(),
  sendClone: vi.fn(() => Promise.resolve({ commandId: "cmd-1" })),
  sendGithubLogin: vi.fn(() => Promise.resolve({ commandId: "cmd-2" })),
  commandResult: vi.fn(() => Promise.resolve({ status: "failed", error: "no sign-in" })),
}));
vi.mock("@/lib/workers-account", () => account);
const engine = vi.hoisted(() => ({
  createCardFromBody: vi.fn(() => ({ id: "c1", cwd: "/dev/app" })),
  startCard: vi.fn(() => ({ started: true })),
  deleteCard: vi.fn(),
}));
vi.mock("@/lib/new-card", () => ({ createCardFromBody: engine.createCardFromBody, startCard: engine.startCard }));
vi.mock("@/lib/store", () => ({
  // Read at import by lib/account.ts (the account client's session file's folder).
  DATA_DIR: "/tmp/weft-workers-route-test-data",
  getCard: (id: string) => ({ id }),
  listCards: () => [],
  deleteCard: engine.deleteCard,
}));
vi.mock("@/lib/copilot", () => ({ prewarm: vi.fn() }));
vi.mock("@/lib/repos", () => ({ projectRoot: (cwd: string) => cwd }));

const workersRoute = await import("./route");
const cardsRoute = await import("../cards/route");

const startOf = async (res: Response) => ((await res.json()) as { start: unknown }).start;
const post = (url: string, body: unknown) => new Request(`http://localhost/api${url}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  folders.list = [];
});

describe("/workers clones and GitHub sign-ins", () => {
  it("queues a clone, and reads how a command went", async () => {
    const res = await workersRoute.POST(post("/workers", { action: "clone", workerId: "w-1", repo: "a/b" }));
    expect(await res.json()).toEqual({ commandId: "cmd-1" });
    expect(account.sendClone).toHaveBeenCalledWith({ workerId: "w-1", repo: "a/b" });
    const got = await workersRoute.GET(new Request("http://localhost/api/workers?command=cmd-1"));
    expect(await got.json()).toEqual({ status: "failed", error: "no sign-in" });
    expect(account.commandResult).toHaveBeenCalledWith("cmd-1");
  });

  it("sends a GitHub sign-in", async () => {
    const res = await workersRoute.POST(post("/workers", { action: "github", workerId: "w-1", token: "t" }));
    expect(await res.json()).toEqual({ commandId: "cmd-2" });
    expect(account.sendGithubLogin).toHaveBeenCalledWith({ workerId: "w-1", token: "t" });
  });

  it("names every action it takes", async () => {
    const res = await workersRoute.POST(post("/workers", { action: "nope" }));
    expect(await res.json()).toEqual({ error: "Say token, run, login, github, clone or folder." });
  });
});

describe("/workers folders", () => {
  it("switches a project to your worker, and back, and lists it without asking Supabase", async () => {
    let res = await workersRoute.POST(post("/workers", { action: "folder", folder: "/dev/app", on: true }));
    expect(await res.json()).toEqual({ folders: ["/dev/app"], worker: "m1mini" });
    res = await workersRoute.GET(new Request("http://localhost/api/workers?folders=1"));
    expect(await res.json()).toEqual({ folders: ["/dev/app"] });
    res = await workersRoute.POST(post("/workers", { action: "folder", folder: "/dev/app", on: false }));
    expect(await res.json()).toEqual({ folders: [] });
    expect(handoff.requireWorker).toHaveBeenCalledTimes(1);
  });

  it("won't switch on without a worker of yours, or without a folder", async () => {
    handoff.requireWorker.mockRejectedValueOnce(new Error("You have no Weft Worker yet."));
    let res = await workersRoute.POST(post("/workers", { action: "folder", folder: "/dev/app", on: true }));
    expect(res.status).toBe(502);
    expect(folders.list).toEqual([]);
    res = await workersRoute.POST(post("/workers", { action: "folder", folder: " ", on: true }));
    expect(res.status).toBe(400);
  });
});

describe("POST /cards in a project that runs on the worker", () => {
  it("starts the card here when the project runs here", async () => {
    const res = await cardsRoute.POST(post("/cards", { prompt: "go", start: true }));
    expect(await startOf(res)).toEqual({ started: true });
    expect(handoff.handOffToWorker).not.toHaveBeenCalled();
  });

  it("hands the card to the worker instead", async () => {
    handoff.runsOnWorker.mockReturnValueOnce(true);
    const res = await cardsRoute.POST(post("/cards", { prompt: "go", start: true }));
    expect(await startOf(res)).toEqual({ started: false, worker: "m1mini" });
    expect(engine.startCard).not.toHaveBeenCalled();
  });

  it("drops the card when the hand-off fails, rather than run it here", async () => {
    handoff.runsOnWorker.mockReturnValueOnce(true);
    handoff.handOffToWorker.mockRejectedValueOnce(new Error("Couldn't send the run"));
    const res = await cardsRoute.POST(post("/cards", { prompt: "go", start: true }));
    expect(res.status).toBe(400);
    expect(engine.deleteCard).toHaveBeenCalledWith("c1");
    expect(engine.startCard).not.toHaveBeenCalled();
  });
});
