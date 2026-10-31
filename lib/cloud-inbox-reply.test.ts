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

const reply = (over: Partial<CloudCommandRow> = {}, payload: unknown = { cardId: "card-7", text: "  ship it  " }) =>
  command({ id: "cmd-r", kind: "reply", payload: payload as CloudCommandRow["payload"], ...over });

async function run(row: CloudCommandRow) {
  db.pending = [row];
  await listening(refreshCloudInbox);
}

beforeEach(() => {
  resetInbox();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
});

afterEach(() => vi.restoreAllMocks());

describe("a reply from the web", () => {
  it("goes to the card as a message you typed, syncs now, and reports done with the card", async () => {
    await run(reply());
    expect(control.sendUserMessage).toHaveBeenCalledWith("card-7", "ship it");
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(control.made).toEqual([]);
    expect(reports()).toEqual([{ status: "done", card_id: "card-7" }]);
  });

  it("is refused for a card that isn't on this Mac, or not in the command's folder", async () => {
    await run(reply({}, { cardId: "gone", text: "hi" }));
    control.cards.set("card-8", { id: "card-8", cwd: "/dev/elsewhere" });
    db.updates.length = 0;
    await run(reply({ id: "cmd-s" }, { cardId: "card-8", text: "hi" }));
    expect(control.sendUserMessage).not.toHaveBeenCalled();
  });

  it("says why it was refused: empty, the copilot, a thread that's gone", async () => {
    await run(reply({}, { cardId: "card-7", text: "   " }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: "That reply is empty." });
    db.updates.length = 0;
    control.cards.set("copilot", { id: "copilot", cwd: "/dev/app", role: "copilot" });
    await run(reply({ id: "cmd-c" }, { cardId: "copilot", text: "hi" }));
    expect(reports()[0]?.error).toMatch(/copilot/);
    db.updates.length = 0;
    await run(reply({ id: "cmd-g" }, { cardId: "nope", text: "hi" }));
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
  });

  it("is held to the same checks as a new card: folder, workspace, author", async () => {
    await run(reply({ folder: "/dev/other" }));
    expect(reports()[0]?.error).toMatch(/Settings → Sync/);
    expect(control.sendUserMessage).not.toHaveBeenCalled();
  });

  it("reports a send that throws as failed", async () => {
    control.sendUserMessage.mockImplementationOnce(() => {
      throw new Error("This thread's folder /dev/app doesn't exist anymore.");
    });
    await run(reply());
    expect(reports()[0]).toMatchObject({ status: "failed" });
    expect(reports()[0]?.error).toMatch(/doesn't exist/);
  });
});
