// A Weft Worker's side of synced folders (lib/worker-tree-sync.ts): its clash priority, and the deps it hands the tree
// channel, from its home (pinned Mac keys, nonce file, work root).
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  pinned: vi.fn(() => ["mac-key"]),
  macKeysAt: vi.fn(),
  fileNonceStore: vi.fn((file: string) => ({ file })),
  nonceBook: vi.fn((store: unknown) => ({ store })),
  workRoot: vi.fn(() => "/root"),
  listProjectFolders: vi.fn(() => ["my-app"]),
  repoPath: vi.fn((root: string, folder: string) => `${root}/${folder}`),
  openRefusal: vi.fn(() => Promise.resolve(null as string | null)),
  watchFolder: vi.fn(() => () => {}),
  busyCards: vi.fn(() => [] as string[]),
  getCard: vi.fn<(id: string) => { cwd?: string } | undefined>(() => undefined),
}));

vi.mock("./worker-mac-keys", () => ({ macKeysAt: m.macKeysAt }));
vi.mock("./widen-nonces", () => ({ fileNonceStore: m.fileNonceStore, nonceBook: m.nonceBook }));
vi.mock("./worker-config", () => ({ workRoot: m.workRoot }));
vi.mock("./worker-folders", () => ({ listProjectFolders: m.listProjectFolders }));
vi.mock("./worker-paths", () => ({ repoPath: m.repoPath }));
vi.mock("./tree-sync-proof", () => ({ openRefusal: m.openRefusal }));
vi.mock("./tree-sync-watch", () => ({ watchFolder: m.watchFolder }));
vi.mock("./runner-state", () => ({ busyCards: m.busyCards }));
vi.mock("./store", () => ({ getCard: m.getCard }));

import type { SyncOpen } from "./tree-sync-proof";
import { BUSY_PRIO, IDLE_PRIO, folderPrio, workerTreeDeps } from "./worker-tree-sync";

const OPEN: SyncOpen = { t: "open", folder: "my-app", mac: { key: "k", sig: "s", issuedAt: 1, nonce: "n" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.macKeysAt.mockReturnValue({ pinned: m.pinned });
});

describe("folderPrio", () => {
  const dir = path.join("/a", "b");
  it("counts more when a thread runs in the folder or under it", () => {
    expect(folderPrio(dir, () => [dir])).toBe(BUSY_PRIO);
    expect(folderPrio(dir, () => ["/x", path.join(dir, "src", "lib")])).toBe(BUSY_PRIO);
  });

  it("doesn't count a sibling sharing the prefix, or no threads", () => {
    expect(folderPrio(dir, () => [`${dir}c`])).toBe(IDLE_PRIO);
    expect(folderPrio(dir, () => [])).toBe(IDLE_PRIO);
    expect(folderPrio(dir, () => ["/a"])).toBe(IDLE_PRIO);
  });

  it("defaults to the busy cards' folders", () => {
    m.busyCards.mockReturnValue(["c1", "c2", "c3"]);
    m.getCard.mockImplementation((id: string) => (id === "c1" ? { cwd: dir } : id === "c2" ? {} : undefined));
    expect(folderPrio(dir)).toBe(BUSY_PRIO);
    expect(folderPrio("/elsewhere")).toBe(IDLE_PRIO);
  });
});

describe("workerTreeDeps", () => {
  const make = (env?: NodeJS.ProcessEnv) => workerTreeDeps({ home: "/home/w", workerId: "w1", name: "Box", env });

  it("reads its home: mac keys, a nonce file and the work root", () => {
    const env = { WEFT_WORKER_ROOT: "/r" } as unknown as NodeJS.ProcessEnv;
    const d = make(env);
    expect(d.self).toEqual({ id: "w1", label: "Box" });
    expect(m.macKeysAt).toHaveBeenCalledWith("/home/w");
    expect(m.fileNonceStore).toHaveBeenCalledWith(path.join("/home/w", "tree-nonces.json"));
    expect(m.workRoot).toHaveBeenCalledWith("/home/w", env);
    make();
    expect(m.workRoot).toHaveBeenLastCalledWith("/home/w", process.env);
  });

  it("allows a signed open for a project on the worker: its dir and git dir", async () => {
    const d = make();
    await expect(d.allow(OPEN)).resolves.toEqual({ dir: "/root/my-app", gitDir: path.join("/root/my-app", ".git") });
    const call = m.openRefusal.mock.calls[0] as unknown as [SyncOpen, { workerId: string; macKeys: () => string[]; nonces: unknown }];
    expect(call[0]).toBe(OPEN);
    expect(call[1].workerId).toBe("w1");
    expect(call[1].macKeys()).toEqual(["mac-key"]);
    expect(call[1].nonces).toEqual({ store: { file: path.join("/home/w", "tree-nonces.json") } });
    expect(m.listProjectFolders).toHaveBeenCalledWith("/root");
    expect(m.repoPath).toHaveBeenCalledWith("/root", "my-app");
  });

  it("throws the proof's refusal", async () => {
    m.openRefusal.mockResolvedValueOnce("That sync request was used already.");
    await expect(make().allow(OPEN)).rejects.toThrow("That sync request was used already.");
    expect(m.listProjectFolders).not.toHaveBeenCalled();
  });

  it("refuses a folder that isn't a project on the worker", async () => {
    m.listProjectFolders.mockReturnValueOnce(["other"]);
    await expect(make().allow(OPEN)).rejects.toThrow("my-app isn't a project on this worker.");
    expect(m.repoPath).not.toHaveBeenCalled();
  });

  it("delegates prio to folderPrio and watch to watchFolder", () => {
    const d = make();
    m.busyCards.mockReturnValue(["c1"]);
    m.getCard.mockReturnValue({ cwd: "/root/my-app" });
    expect(d.prio("/root/my-app")).toBe(BUSY_PRIO);
    const onPaths = vi.fn();
    const close = vi.fn();
    m.watchFolder.mockReturnValueOnce(close);
    expect(d.watch("/root/my-app", onPaths)).toBe(close);
    expect(m.watchFolder).toHaveBeenCalledWith("/root/my-app", onPaths);
  });
});
