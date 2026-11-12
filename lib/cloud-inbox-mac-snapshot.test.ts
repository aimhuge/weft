// Another Mac's `host` command for tree.snapshot (lib/cloud-inbox-cards.ts macRules.hostVerb, macCheck): the one
// host-level verb a Mac takes from the network, addressed by the project's folder name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { command, control, db, listening, reports, resetInbox } from "./cloud-inbox.harness";
import type { CloudCommandRow } from "./cloud-commands";

vi.mock("./account", async () => (await import("./cloud-inbox.harness")).accountMock);
vi.mock("./settings", async () => (await import("./cloud-inbox.harness")).settingsMock);
vi.mock("./device-id", async () => (await import("./cloud-inbox.harness")).deviceMock);
vi.mock("./desktop-worker", async () => (await import("./cloud-inbox.harness")).desktopWorkerMock);
vi.mock("./device-calls", async () => (await import("./cloud-inbox.harness")).deviceCallsMock);
vi.mock("./cloud-sync", async () => (await import("./cloud-inbox.harness")).cloudSyncMock);
vi.mock("./new-card", async () => (await import("./cloud-inbox.harness")).newCardMock);
vi.mock("./runner", async () => (await import("./cloud-inbox.harness")).runnerMock);
vi.mock("./host-api", async (real) => (await import("./cloud-inbox.harness")).hostApiMock(real));
vi.mock("./store", async () => (await import("./cloud-inbox.harness")).storeMock);
vi.mock("./browser-shell", () => ({ shell: vi.fn(() => Promise.resolve({ ok: true, approvers: 0 })) }));
const snap = vi.hoisted(() => ({ macSnapshotVerb: vi.fn() }));
vi.mock("./mac-snapshot", () => snap);

const { refreshCloudInbox } = await import("./cloud-inbox");

const run = (row: CloudCommandRow) => {
  db.updates.length = 0;
  db.pending = [row];
  return listening(refreshCloudInbox);
};
const ask = (verb: string, over: Partial<CloudCommandRow> = {}) =>
  command({ id: "cmd-m", kind: "host", folder: "app", payload: { verb, args: { id: "", folder: "app", origin: "me/app", widen: { k: 1 } } } as never, ...over });

beforeEach(() => {
  resetInbox();
  control.folders = ["/dev/app", "/dev/weft"];
  snap.macSnapshotVerb.mockReset();
  snap.macSnapshotVerb.mockResolvedValue({ sha: "s", running: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("tree.snapshot from another Mac", () => {
  it("hands the signed ask to macSnapshotVerb and reports its answer", async () => {
    await run(ask("tree.snapshot"));
    expect(snap.macSnapshotVerb).toHaveBeenCalledWith({ id: "", folder: "app", origin: "me/app", widen: { k: 1 } });
    expect(reports()).toEqual([{ status: "done", card_id: null, result: expect.objectContaining({ ok: true }) as unknown }]);
  });

  it("resolves the project by name to a synced folder here, and refuses one that isn't", async () => {
    await run(ask("tree.snapshot", { folder: "nope" }));
    expect(snap.macSnapshotVerb).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/nope isn't switched on in Settings → Sync/);
    control.folders = ["/a/app", "/b/app"];
    await run(ask("tree.snapshot"));
    expect(reports()[0]?.error).toMatch(/isn't switched on/);
  });

  it("is still held to the author check", async () => {
    await run(ask("tree.snapshot", { created_by: "someone-else" }));
    expect(snap.macSnapshotVerb).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/wasn't made by the account/);
  });

  it("takes no other host-level verb", async () => {
    for (const verb of ["settings.get", "settings.put"]) {
      await run(ask(verb));
      expect(snap.macSnapshotVerb).not.toHaveBeenCalled();
      expect(reports()[0]?.status).toBe("failed");
    }
    expect(control.verbs).toEqual([]);
  });

  it("keeps a plain host row's folder a path, not a name", async () => {
    control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
    await run(command({ kind: "host", folder: "app", payload: { verb: "card.stop", args: { id: "card-7" } } as never }));
    expect(reports()[0]?.error).toMatch(/isn't switched on/);
  });
});
