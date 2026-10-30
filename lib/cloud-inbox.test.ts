import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beats, client, command, control, db, listening, reports, resetInbox, settle } from "./cloud-inbox.harness";

vi.mock("./account", async () => (await import("./cloud-inbox.harness")).accountMock);
vi.mock("./settings", async () => (await import("./cloud-inbox.harness")).settingsMock);
vi.mock("./device-id", async () => (await import("./cloud-inbox.harness")).deviceMock);
vi.mock("./desktop-worker", async () => (await import("./cloud-inbox.harness")).desktopWorkerMock);
vi.mock("./cloud-sync", async () => (await import("./cloud-inbox.harness")).cloudSyncMock);
vi.mock("./new-card", async () => (await import("./cloud-inbox.harness")).newCardMock);
vi.mock("./runner", async () => (await import("./cloud-inbox.harness")).runnerMock);
vi.mock("./store", async () => (await import("./cloud-inbox.harness")).storeMock);

const { refreshCloudInbox, startCloudInbox, syncFolderFor } = await import("./cloud-inbox");

const open = () => listening(refreshCloudInbox);
const noAccounts = () => {
  throw new Error("no accounts");
};
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetInbox();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("the inbox", () => {
  it("listens for this device's commands and runs a pending one: claim, make the card, start it, report", async () => {
    db.pending = [command()];
    await open();
    expect(db.channels).toHaveLength(1);
    expect(db.channels[0]).toMatchObject({ name: "cloud-commands-mac-1", filter: "target_device=eq.mac-1" });
    expect(db.selects[0]).toEqual(expect.arrayContaining([["target_device", "mac-1"], ["created_by", "u1"], ["status", "pending"]]));
    expect(db.updates[0]).toMatchObject({ patch: { status: "claimed" }, filters: [["id", "cmd-1"], ["status", "pending"]] });
    expect(control.made).toEqual([expect.objectContaining({ prompt: "Add dark mode", cwd: "/dev/app", backend: "claude" })]);
    expect(control.startCard).toHaveBeenCalledWith({ id: "card-1" });
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(reports()).toEqual([{ status: "done", card_id: "card-1" }]);
  });

  it("looks again when the table nudges it, and runs what it finds", async () => {
    await open();
    expect(control.made).toEqual([]);
    db.pending = [command({ id: "cmd-2" })];
    db.channels[0]?.nudge();
    await settle();
    expect(control.made).toHaveLength(1);
  });

  it("looks once more when a nudge lands mid-drain, and not once per nudge", async () => {
    await open();
    expect(db.selects).toHaveLength(1);
    db.channels[0]?.nudge();
    db.channels[0]?.nudge();
    db.channels[0]?.nudge();
    await settle();
    // The first nudge drains; the two that land while it reads are one more pass, not two.
    expect(db.selects).toHaveLength(3);
  });

  it("keeps one channel for the same account and drains on each check", async () => {
    await open();
    await refreshCloudInbox();
    expect(db.channels).toHaveLength(1);
    expect(db.selects).toHaveLength(2);
  });

  it("moves to a new channel when the account changes", async () => {
    await open();
    db.user = "u2";
    await refreshCloudInbox();
    expect(db.removed).toBe(1);
    expect(db.channels).toHaveLength(2);
  });

  it("holds nothing open when signed out, with no synced folder, or without accounts", async () => {
    db.user = null;
    await refreshCloudInbox();
    db.user = "u1";
    control.folders = [];
    await refreshCloudInbox();
    expect(db.channels).toHaveLength(0);
    control.account = noAccounts;
    await refreshCloudInbox();
    expect(db.channels).toHaveLength(0);
  });

  it("closes the channel when the last synced folder is switched off", async () => {
    await open();
    control.folders = [];
    await refreshCloudInbox();
    expect(db.removed).toBe(1);
  });

  it("does nothing when the user signs out between the nudge and the read", async () => {
    await open();
    db.user = null;
    db.channels[0]?.nudge();
    await settle();
    expect(db.selects).toHaveLength(1);
  });

  it("does nothing when the account is gone between the nudge and the read", async () => {
    await open();
    control.account = noAccounts;
    db.channels[0]?.nudge();
    await settle();
    expect(db.selects).toHaveLength(1);
  });

  it("warns instead of throwing when it can't read the table or open the channel", async () => {
    db.selectError = "boom";
    await open();
    expect(warn).toHaveBeenCalledWith("Cloud inbox: boom");
    control.account = () => ({ ...client, auth: { ...client.auth, getSession: () => Promise.reject(new Error("offline")) } });
    await refreshCloudInbox();
    expect(warn).toHaveBeenCalledWith("Cloud inbox: offline");
  });
});

describe("as a desktop worker", () => {
  it("beats into the Workers list while it listens, and not when signed out", async () => {
    await open();
    expect(beats).toEqual(["u1"]);
    db.user = null;
    await refreshCloudInbox();
    expect(beats).toEqual(["u1"]);
  });

  it("starts a new card that names its synced folder by project name", async () => {
    db.pending = [command({ folder: "app" })];
    await open();
    expect(control.made).toEqual([expect.objectContaining({ cwd: "/dev/app" })]);
    expect(reports()).toEqual([{ status: "done", card_id: "card-1" }]);
  });

  it("finds a folder by path or by a name only one synced folder has", () => {
    control.folders = ["/dev/app", "/work/app", "/dev/weft"];
    expect(syncFolderFor("/work/app")).toBe("/work/app");
    expect(syncFolderFor("weft")).toBe("/dev/weft");
    expect(syncFolderFor("app")).toBeNull();
    expect(syncFolderFor("nope")).toBeNull();
  });
});

describe("startCloudInbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("follows sign-in and sign-out, and checks on a timer", async () => {
    const stop = startCloudInbox();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.channels).toHaveLength(1);
    db.authListener?.();
    await vi.advanceTimersByTimeAsync(0);
    const before = db.selects.length;
    expect(before).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(db.selects.length).toBeGreaterThan(before);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.unsubscribed).toBe(1);
    expect(db.removed).toBe(1);
    const after = db.selects.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.selects).toHaveLength(after);
  });

  it("starts once per process", async () => {
    const stop = startCloudInbox();
    startCloudInbox()();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.channels).toHaveLength(1);
    stop();
  });

  it("starts without accounts: nothing to hear", () => {
    control.account = noAccounts;
    const stop = startCloudInbox();
    expect(() => stop()).not.toThrow();
  });
});
