import { describe, expect, it, vi } from "vitest";

const shellMock = vi.hoisted(() => vi.fn());
vi.mock("./browser-shell", () => ({ shell: shellMock }));
vi.mock("./device-id", () => ({ deviceId: () => "me-device" }));
vi.mock("./repos", () => ({ githubRepoOf: () => "o/default" }));
vi.mock("./runner-state", () => ({ busyCards: () => ["c1", "c2", "gone"] }));
vi.mock("./settings", () => ({ syncFolders: () => ["/dev/default"] }));
vi.mock("./store", () => ({ getCard: (id: string) => (id === "c1" ? { cwd: "/dev/default/sub" } : id === "c2" ? { cwd: "/dev/other" } : undefined) }));
vi.mock("./wip-snapshot", () => ({ snapshotWip: vi.fn(() => Promise.resolve({ sha: "s" })), pushWip: vi.fn(() => Promise.resolve()) }));

const { macSnapshotVerb, UNSIGNED, NOT_HERE, OTHER_REPO } = await import("./mac-snapshot");
type Deps = NonNullable<Parameters<typeof macSnapshotVerb>[1]>;

const args = { id: "", folder: "weft", origin: "Me/Weft", mac: "Studio", widen: { kind: "ed25519", device: "asker", nonce: "n".repeat(16), issuedAt: 1_000, sig: "sig" } };
function deps(over: Partial<Deps> = {}): Deps {
  return {
    self: () => "me-device",
    name: () => "Air",
    now: () => 1_000,
    nonces: { has: () => false, take: () => Promise.resolve(true) },
    verify: vi.fn(() => Promise.resolve({ ok: true })),
    folders: () => ["/dev/weft", "/dev/other"],
    repoOf: () => "me/weft",
    snapshot: vi.fn(() => Promise.resolve({ sha: "s1" })) as never,
    push: vi.fn(() => Promise.resolve()),
    running: () => 2,
    ...over,
  };
}

describe("macSnapshotVerb", () => {
  it("snapshots and pushes the project the signed ask names, with the running count", async () => {
    const d = deps();
    expect(await macSnapshotVerb(args, d)).toEqual({ sha: "s1", running: 2 });
    expect(d.snapshot).toHaveBeenCalledWith("/dev/weft", { device: "me-device", mac: "Air" });
    expect(d.push).toHaveBeenCalledWith("/dev/weft", "me-device");
    // The message main checks is rebuilt from this Mac's own id.
    const message = (d.verify as ReturnType<typeof vi.fn<(b: { message: string }) => Promise<unknown>>>).mock.calls[0]?.[0].message as string;
    expect(JSON.parse(message)).toMatchObject({ host: "me-device", verb: "tree.snapshot", change: { wip: { folder: "weft", origin: "Me/Weft", mac: "Studio" } } });
  });

  it("wants a project and a repo", async () => {
    await expect(macSnapshotVerb({ ...args, folder: "" }, deps())).rejects.toThrow("Which project");
    await expect(macSnapshotVerb({ ...args, origin: undefined }, deps())).rejects.toThrow("Which project");
  });

  it("refuses a missing or bad approval, and does not touch the tree", async () => {
    const d = deps();
    await expect(macSnapshotVerb({ ...args, widen: undefined }, d)).rejects.toThrow(UNSIGNED);
    const bad = deps({ verify: () => Promise.resolve({ ok: false, reason: "not paired" }) });
    await expect(macSnapshotVerb(args, bad)).rejects.toThrow("not paired");
    expect(bad.snapshot).not.toHaveBeenCalled();
  });

  it("refuses an approval this Mac signed itself", async () => {
    const d = deps({ self: () => "asker" });
    // Its own key is never in the Mac pin list, so main's verify says no.
    d.verify = () => Promise.resolve({ ok: false, reason: "That Mac isn't paired" });
    await expect(macSnapshotVerb(args, d)).rejects.toThrow("isn't paired");
  });

  it("refuses a project not switched on here, or two by one name", async () => {
    await expect(macSnapshotVerb(args, deps({ folders: () => ["/dev/other"] }))).rejects.toThrow(NOT_HERE);
    await expect(macSnapshotVerb(args, deps({ folders: () => ["/a/weft", "/b/weft"] }))).rejects.toThrow(NOT_HERE);
  });

  it("refuses a project whose repo isn't the one named, case aside", async () => {
    await expect(macSnapshotVerb(args, deps({ repoOf: () => "me/else" }))).rejects.toThrow(OTHER_REPO);
    await expect(macSnapshotVerb(args, deps({ repoOf: () => undefined }))).rejects.toThrow(OTHER_REPO);
    await expect(macSnapshotVerb(args, deps({ repoOf: () => "ME/WEFT" }))).resolves.toBeTruthy();
  });
});

describe("macSnapshotVerb's own wiring", () => {
  it("spends the nonce and verifies through main, then uses this Mac's settings", async () => {
    const issuedAt = Date.now();
    const live = { ...args, widen: { ...args.widen, issuedAt } };
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/widen-nonce" ? { ok: true } : { ok: true }));
    const wip = await import("./wip-snapshot");
    // The default folder list has no project called weft.
    await expect(macSnapshotVerb(live)).rejects.toThrow(NOT_HERE);
    expect(shellMock).toHaveBeenCalledWith("/pairing/verify-mac", expect.objectContaining({ device: "asker" }));
    expect(shellMock).toHaveBeenCalledWith("/pairing/widen-nonce", { nonce: "n".repeat(16), issuedAt });
    // Matching the default folder runs the default repo check, then the snapshot.
    expect(wip.snapshotWip).not.toHaveBeenCalled();
    await expect(macSnapshotVerb({ ...live, folder: "default", origin: "o/default" })).resolves.toMatchObject({ sha: "s", running: 1 });
    expect(wip.pushWip).toHaveBeenCalledWith("/dev/default", "me-device");
    // A spent nonce is refused.
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/widen-nonce" ? { ok: false } : { ok: true }));
    await expect(macSnapshotVerb({ ...live, folder: "default", origin: "o/default" })).rejects.toThrow(/used already/);
  });
});
