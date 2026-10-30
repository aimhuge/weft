import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerView } from "./workers-account";

vi.mock("./account", () => ({ accountClient: () => ({}) }));
const listWorkers = vi.fn<(client?: unknown) => Promise<{ signedIn: boolean; workers: WorkerView[] }>>();
const sendRun = vi.fn<(body: unknown, client?: unknown) => Promise<{ commandId: string }>>(() => Promise.resolve({ commandId: "cmd-1" }));
vi.mock("./workers-account", () => ({ listWorkers: (c?: unknown) => listWorkers(c), sendRun: (b: unknown, c?: unknown) => sendRun(b, c) }));
const workerFolders = vi.fn(() => ["/dev/app"]);
vi.mock("./settings", () => ({ workerFolders: () => workerFolders() }));
const githubRepoOf = vi.fn<(folder: string) => string | undefined>(() => "me/app");
vi.mock("./repos", () => ({ projectRoot: (cwd: string) => (cwd.startsWith("/dev/app") ? "/dev/app" : cwd), githubRepoOf: (f: string) => githubRepoOf(f) }));
vi.mock("./automations", () => ({ firstMessage: (card: { prompt: string }) => `${card.prompt}!` }));
const appendThread = vi.fn<(id: string, item: unknown) => number>(() => 0);
const updateCard = vi.fn<(id: string, patch: unknown) => void>();
vi.mock("./store", () => ({ appendThread: (id: string, item: unknown) => appendThread(id, item), updateCard: (id: string, patch: unknown) => updateCard(id, patch) }));

const { handOffToWorker, pickWorker, requireWorker, runsOnWorker } = await import("./worker-handoff");

const worker = (over: Partial<WorkerView>): WorkerView => ({ id: "w", name: "box", platform: "linux", arch: "x64", status: "online", lastSeenAt: null, mine: true, kind: "headless", device: null, here: false, githubAccount: null, githubState: null, cloneError: null, ...over });
const client = {} as SupabaseClient;
const card = { id: "c1", cwd: "/dev/app/.wt/one", prompt: "fix it" } as Parameters<typeof handOffToWorker>[0];

beforeEach(() => vi.clearAllMocks());

describe("runsOnWorker", () => {
  it("counts a worktree toward its main repo", () => {
    expect(runsOnWorker("/dev/app/.wt/one")).toBe(true);
    expect(runsOnWorker("/dev/other")).toBe(false);
  });
});

describe("pickWorker", () => {
  it("takes one of yours, online before busy before offline", () => {
    const off = worker({ id: "off", status: "offline" });
    const busy = worker({ id: "busy", status: "busy" });
    const theirs = worker({ id: "theirs", mine: false });
    expect(pickWorker([theirs, off, busy, worker({ id: "on" })])?.id).toBe("on");
    expect(pickWorker([off, busy])?.id).toBe("busy");
    expect(pickWorker([off])?.id).toBe("off");
    expect(pickWorker([theirs])).toBeUndefined();
  });
});

describe("requireWorker", () => {
  it("says to sign in, or to add a worker, when there's none to send to", async () => {
    listWorkers.mockResolvedValueOnce({ signedIn: false, workers: [] });
    await expect(requireWorker(client)).rejects.toThrow("Sign in to Weft");
    listWorkers.mockResolvedValueOnce({ signedIn: true, workers: [worker({ mine: false })] });
    await expect(requireWorker(client)).rejects.toThrow("You have no Weft Worker yet");
  });

  it("uses the account's own client by default", async () => {
    listWorkers.mockResolvedValueOnce({ signedIn: true, workers: [worker({})] });
    await expect(requireWorker()).resolves.toMatchObject({ name: "box" });
  });
});

describe("handOffToWorker", () => {
  it("sends the first message under the project's name and remote, and records it on the card in Review", async () => {
    listWorkers.mockResolvedValueOnce({ signedIn: true, workers: [worker({ id: "w1", name: "m1mini" })] });
    await expect(handOffToWorker(card, client)).resolves.toEqual({ started: false, worker: "m1mini" });
    expect(sendRun).toHaveBeenCalledWith({ workerId: "w1", folder: "app", prompt: "fix it!", repo: "https://github.com/me/app.git" }, client);
    expect(appendThread).toHaveBeenCalledWith("c1", expect.objectContaining({ kind: "user", text: "fix it!" }));
    expect(appendThread).toHaveBeenCalledWith("c1", expect.objectContaining({ kind: "assistant", text: expect.stringContaining("**m1mini**") as unknown }));
    expect(updateCard).toHaveBeenCalledWith("c1", { column: "review" });
  });

  it("sends no git URL for a project without a GitHub remote", async () => {
    listWorkers.mockResolvedValueOnce({ signedIn: true, workers: [worker({})] });
    githubRepoOf.mockReturnValueOnce(undefined);
    await handOffToWorker(card);
    expect(sendRun).toHaveBeenCalledWith(expect.objectContaining({ repo: undefined }), expect.anything());
  });

  it("leaves the card alone when the run can't be sent", async () => {
    listWorkers.mockResolvedValueOnce({ signedIn: true, workers: [worker({})] });
    sendRun.mockRejectedValueOnce(new Error("Couldn't send the run: nope"));
    await expect(handOffToWorker(card, client)).rejects.toThrow("nope");
    expect(appendThread).not.toHaveBeenCalled();
    expect(updateCard).not.toHaveBeenCalled();
  });
});
