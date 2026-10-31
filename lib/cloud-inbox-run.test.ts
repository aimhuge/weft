import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, control, db, listening, reports, resetInbox } from "./cloud-inbox.harness";
import type { CloudCommandRow } from "./cloud-commands";

vi.mock("./account", async () => (await import("./cloud-inbox.harness")).accountMock);
vi.mock("./settings", async () => (await import("./cloud-inbox.harness")).settingsMock);
vi.mock("./device-id", async () => (await import("./cloud-inbox.harness")).deviceMock);
vi.mock("./desktop-worker", async () => (await import("./cloud-inbox.harness")).desktopWorkerMock);
vi.mock("./cloud-sync", async () => (await import("./cloud-inbox.harness")).cloudSyncMock);
vi.mock("./new-card", async () => (await import("./cloud-inbox.harness")).newCardMock);
vi.mock("./runner", async () => (await import("./cloud-inbox.harness")).runnerMock);
vi.mock("./store", async () => (await import("./cloud-inbox.harness")).storeMock);

const { refreshCloudInbox } = await import("./cloud-inbox");

const open = () => listening(refreshCloudInbox);
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetInbox();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("refusing a command", () => {
  async function failsWith(row: CloudCommandRow, message: RegExp) {
    db.pending = [row];
    await open();
    expect(control.made).toEqual([]);
    expect(control.startCard).not.toHaveBeenCalled();
    const [report] = reports();
    expect(report).toMatchObject({ status: "failed" });
    expect(report?.error).toMatch(message);
  }

  it("a folder that isn't switched on in Settings → Sync", async () => {
    await failsWith(command({ folder: "/dev/other" }), /isn't switched on in Settings → Sync/);
  });

  it("another workspace than the one this Mac syncs to, or none", async () => {
    await failsWith(command({ org_id: "org2" }), /isn't the one this Mac syncs/);
    db.updates.length = 0;
    control.org = null;
    await failsWith(command({ id: "cmd-2" }), /isn't the one this Mac syncs/);
  });

  it("a kind it doesn't know, and a command from another account", async () => {
    await failsWith(command({ kind: "share" as never }), /doesn't know that kind/);
    db.updates.length = 0;
    await failsWith(command({ id: "cmd-2", created_by: "u2" }), /wasn't made by the account/);
  });

  it("a card that can't be made, with the reason cut to a short length", async () => {
    control.createCardFromBody.mockImplementationOnce(() => {
      throw new Error("x".repeat(400));
    });
    db.pending = [command()];
    await open();
    expect(reports()[0]?.error).toHaveLength(300);
    expect(control.startCard).not.toHaveBeenCalled();
  });
});

describe("claiming", () => {
  it("leaves a command another run already claimed", async () => {
    db.claim = false;
    db.pending = [command()];
    await open();
    expect(control.made).toEqual([]);
    expect(reports()).toEqual([]);
  });

  it("leaves a command it couldn't claim", async () => {
    db.claimError = "denied";
    db.pending = [command()];
    await open();
    expect(control.made).toEqual([]);
  });

  it("warns when it can't report back, but never makes the card twice", async () => {
    db.reportError = "offline";
    db.pending = [command()];
    await open();
    expect(warn).toHaveBeenCalledWith("Cloud inbox: couldn't report on cmd-1: offline");
    expect(control.made).toHaveLength(1);
  });
});
