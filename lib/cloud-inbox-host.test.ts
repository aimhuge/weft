// A `host` command to this Mac (lib/cloud-inbox-cards.ts hostFromCommand): any verb of lib/host-api, held to the
// inbox's checks, the answer kind's approval rule for an answer, and the phone rule for any other verb that grants power.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const shellMock = vi.hoisted(() => vi.fn((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true })));
vi.mock("./browser-shell", () => ({ shell: shellMock }));

const { refreshCloudInbox } = await import("./cloud-inbox");
const { ELEVATED_REFUSED } = await import("./cloud-inbox-cards");

const run = (row: CloudCommandRow) => {
  db.updates.length = 0;
  db.pending = [row];
  return listening(refreshCloudInbox);
};
const host = (verb: string, args: Record<string, unknown> = {}, over: Partial<CloudCommandRow> = {}) =>
  command({ id: "cmd-h", kind: "host", payload: { verb, args: { id: "card-7", ...args } } as never, ...over });

// A paired phone, and whether Settings → Sync lets the web approve.
function paired(webApprovals = false) {
  vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
  shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 1, webApprovals } : { ok: true }));
}

beforeEach(() => {
  resetInbox();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
});

afterEach(() => {
  shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true }));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a host command from the web", () => {
  it("runs the verb on the card, syncs, and writes the result", async () => {
    await run(host("card.update", { body: { title: "New" } }));
    expect(control.verbs).toEqual([{ verb: "card.update", args: { id: "card-7", body: { title: "New" } } }]);
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(reports()).toEqual([{ status: "done", card_id: "card-7", result: { ok: true, cardId: "card-7" } }]);
  });

  it("fails an unknown verb, with the failure in the result", async () => {
    await run(host("card.explode"));
    const error = "This host doesn't run card.explode. Update it to the newest Weft.";
    expect(reports()).toEqual([{ status: "failed", error, result: { ok: false, error } }]);
    expect(control.verbs).toEqual([]);
  });

  it("is held to the inbox's checks: a card in the folder, never the copilot, the author", async () => {
    await run(host("card.stop", { id: "gone" }));
    expect(reports()[0]?.error).toBe("That thread isn't on this Mac anymore.");
    control.cards.set("copilot", { id: "copilot", cwd: "/dev/app", role: "copilot" });
    await run(host("card.stop", { id: "copilot" }));
    expect(reports()[0]?.error).toBe("The copilot can't be reached from the web.");
    await run(host("card.stop", {}, { created_by: "someone-else" }));
    expect(reports()[0]?.error).toMatch(/wasn't made by the account/);
    expect(control.verbs).toEqual([]);
  });

  it("never skips permission prompts", async () => {
    await run(host("card.update", { body: { permissionMode: "bypassPermissions" } }));
    expect(reports()[0]?.error).toMatch(/can't skip permission prompts/);
    expect(control.verbs).toEqual([]);
  });

  it("never runs a shell from the web, phone or no phone", async () => {
    await run(host("card.shell", { command: "ls" }));
    expect(reports()[0]?.error).toMatch(/shell command only runs/);
    expect(control.verbs).toEqual([]);
  });

  it("runs a verb that grants power while no phone is paired, or the web may approve, and not otherwise", async () => {
    await run(host("card.permission.first", { pendingId: "p1" }));
    expect(control.verbs).toHaveLength(1);
    paired();
    await run(host("card.permission.first", { pendingId: "p1" }));
    expect(reports()[0]?.error).toBe(ELEVATED_REFUSED);
    await run(host("card.update", { body: { title: "Fine" } }));
    expect(reports()[0]).toMatchObject({ status: "done" });
    paired(true);
    await run(host("card.permission.wait", { pendingId: "p1" }));
    // A second run on the open channel drains twice; the claim keeps a real command to one run.
    expect([...new Set(control.verbs.map((v) => v.verb))]).toEqual(["card.permission.first", "card.update", "card.permission.wait"]);
  });
});

describe("a host answer", () => {
  it("answers as the answer kind does, and writes the result", async () => {
    await run(host("card.permission.answer", { pendingId: "p1", allow: true, answers: { q: "a" }, chat: "talk" }));
    expect(control.answerPermission).toHaveBeenCalledWith("card-7", true, { q: "a" }, "p1", { chat: "talk" });
    expect(reports()).toEqual([{ status: "done", card_id: "card-7", result: { ok: true, cardId: "card-7" } }]);
  });

  it("needs the request's pendingId, and an unsigned Allow waits for a paired phone", async () => {
    await run(host("card.permission.answer", { allow: true }));
    expect(reports()[0]?.error).toBe("That answer is empty.");
    paired();
    await run(host("card.permission.answer", { pendingId: "p1", allow: true }));
    expect(reports()[0]?.error).toMatch(/paired phone/);
    expect(control.answerPermission).not.toHaveBeenCalled();
    await run(host("card.permission.answer", { pendingId: "p1", allow: true, auth: { device: "phone-1", issuedAt: Date.now(), sig: "sig" } }));
    expect(shellMock).toHaveBeenCalledWith("/pairing/verify", expect.objectContaining({ device: "phone-1", sig: "sig" }));
    expect(control.answerPermission).toHaveBeenCalledWith("card-7", true, undefined, "p1", undefined);
  });
});

describe("the kinds a Mac runs", () => {
  it("still refuses mode, which only a worker takes", async () => {
    await run(command({ kind: "mode", payload: { cardId: "card-7", mode: "auto" } as never }));
    expect(reports()[0]?.error).toBe("This version of Weft doesn't know that kind of request. Update the desktop app.");
  });
});
