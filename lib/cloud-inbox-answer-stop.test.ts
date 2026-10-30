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
// Main's pairing routes (electron/pairing-ipc.cjs): no phone paired unless a test says so.
const shellMock = vi.hoisted(() => vi.fn((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true })));
vi.mock("./browser-shell", () => ({ shell: shellMock }));

const { refreshCloudInbox } = await import("./cloud-inbox");

const run = (row: CloudCommandRow) => {
  db.pending = [row];
  return listening(refreshCloudInbox);
};

beforeEach(() => {
  resetInbox();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
});

afterEach(() => vi.restoreAllMocks());

describe("an answer once a phone is paired", () => {
  const allow = (payload: Record<string, unknown> = {}) => command({ id: "cmd-p", kind: "answer", payload: { cardId: "card-7", pendingId: "p1", allow: true, ...payload } as CloudCommandRow["payload"] });

  it("refuses an unsigned Allow, and runs a signed one main verifies", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 1 } : { ok: true }));
    await run(allow());
    expect(control.answerPermission).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/paired phone/);
    db.updates.length = 0;
    await run(allow({ auth: { device: "phone-1", issuedAt: Date.now(), sig: "sig" } }));
    expect(shellMock).toHaveBeenCalledWith("/pairing/verify", expect.objectContaining({ device: "phone-1", sig: "sig" }));
    expect(control.answerPermission).toHaveBeenCalledWith("card-7", true, undefined, "p1", undefined);
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true }));
    vi.unstubAllEnvs();
  });
});

describe("an answer from the web", () => {
  const answer = (over: Partial<CloudCommandRow> = {}, payload: unknown = { cardId: "card-7", pendingId: "p1", allow: true, answers: { q: "a" } }) =>
    command({ id: "cmd-a", kind: "answer", payload: payload as CloudCommandRow["payload"], ...over });

  it("routes to answerPermission with the right allow/answers/pendingId/reply, syncs, and reports done", async () => {
    await run(answer({}, { cardId: "card-7", pendingId: "p1", allow: true, answers: { q: "a" }, reply: { chat: "talk" } }));
    expect(control.answerPermission).toHaveBeenCalledWith("card-7", true, { q: "a" }, "p1", { chat: "talk" });
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(control.made).toEqual([]);
    expect(reports()).toEqual([{ status: "done", card_id: "card-7" }]);
  });

  it("is refused for a card that isn't on this Mac, or not in the command's folder", async () => {
    await run(answer({ id: "cmd-g" }, { cardId: "gone", pendingId: "p1", allow: true }));
    expect(control.answerPermission).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
    db.updates.length = 0;
    control.cards.set("card-8", { id: "card-8", cwd: "/dev/elsewhere" });
    await run(answer({ id: "cmd-s" }, { cardId: "card-8", pendingId: "p1", allow: true }));
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
  });

  it("refuses an empty payload, the copilot, and a permission that isn't waiting any more", async () => {
    await run(answer({}, { cardId: "card-7" }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: "That answer is empty." });
    db.updates.length = 0;
    control.cards.set("copilot", { id: "copilot", cwd: "/dev/app", role: "copilot" });
    await run(answer({ id: "cmd-c" }, { cardId: "copilot", pendingId: "p1", allow: true }));
    expect(reports()[0]?.error).toMatch(/copilot/);
    db.updates.length = 0;
    control.answerPermission.mockImplementationOnce(() => {
      throw new Error("That request isn't waiting anymore.");
    });
    await run(answer({ id: "cmd-w" }));
    expect(reports()[0]).toMatchObject({ status: "failed" });
    expect(reports()[0]?.error).toMatch(/isn't waiting/);
  });

  it("is held to the same checks as a new card: folder, workspace, author", async () => {
    await run(answer({ folder: "/dev/other" }));
    expect(reports()[0]?.error).toMatch(/Settings → Sync/);
    expect(control.answerPermission).not.toHaveBeenCalled();
  });
});

describe("a stop from the web", () => {
  const stop = (over: Partial<CloudCommandRow> = {}, payload: unknown = { cardId: "card-7" }) =>
    command({ id: "cmd-s", kind: "stop", payload: payload as CloudCommandRow["payload"], ...over });

  it("awaits runner.stop on the card, syncs, and reports done", async () => {
    await run(stop());
    expect(control.stop).toHaveBeenCalledWith("card-7");
    expect(control.syncNow).toHaveBeenCalledTimes(1);
    expect(reports()).toEqual([{ status: "done", card_id: "card-7" }]);
  });

  it("is refused for a card that isn't on this Mac, or not in the command's folder", async () => {
    await run(stop({ id: "cmd-g" }, { cardId: "gone" }));
    expect(control.stop).not.toHaveBeenCalled();
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
    db.updates.length = 0;
    control.cards.set("card-8", { id: "card-8", cwd: "/dev/elsewhere" });
    await run(stop({ id: "cmd-s" }, { cardId: "card-8" }));
    expect(reports()[0]?.error).toMatch(/isn't on this Mac/);
  });

  it("refuses an empty payload and the copilot", async () => {
    await run(stop({}, { cardId: "" }));
    expect(reports()[0]).toMatchObject({ status: "failed", error: "That stop is missing the card." });
    db.updates.length = 0;
    control.cards.set("copilot", { id: "copilot", cwd: "/dev/app", role: "copilot" });
    await run(stop({ id: "cmd-c" }, { cardId: "copilot" }));
    expect(reports()[0]?.error).toMatch(/copilot/);
  });

  it("is held to the same checks as a new card: folder, workspace, author", async () => {
    await run(stop({ folder: "/dev/other" }));
    expect(reports()[0]?.error).toMatch(/Settings → Sync/);
    expect(control.stop).not.toHaveBeenCalled();
  });
});

describe("a folder grant on an answer to a card on this Mac", () => {
  const prompt = { id: "p1", toolName: "Read", title: "t", input: {}, readScope: { directory: "/Users/me/data", token: "~/data" } };
  const grantAnswer = (grant: string) => command({ id: "cmd-f", kind: "answer", payload: { cardId: "card-7", pendingId: "p1", allow: true, grant, directory: "/" } as CloudCommandRow["payload"] });

  beforeEach(() => control.cards.set("card-7", { id: "card-7", cwd: "/dev/app", pending: prompt }));

  it("adds This card to the card and Always to this Mac, from the waiting request", async () => {
    await run(grantAnswer("card"));
    expect(control.cards.get("card-7")?.readScope).toEqual(["/Users/me/data"]);
    expect(control.allowed).toEqual([]);
    db.updates.length = 0;
    await run(grantAnswer("always"));
    expect(control.allowed).toContain("/Users/me/data");
  });

  it("writes no grant when the phone rule refuses the answer", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 1 } : { ok: true }));
    await run(grantAnswer("always"));
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 0 } : { ok: true }));
    vi.unstubAllEnvs();
    expect(control.answerPermission).not.toHaveBeenCalled();
    expect(control.allowed).toEqual([]);
  });

  it("refuses a grant on a question, which skips the phone rule", async () => {
    control.cards.set("card-7", { id: "card-7", cwd: "/dev/app", pending: { ...prompt, questions: [] } });
    await run(grantAnswer("always"));
    expect(reports()[0]?.error).toMatch(/no folder/);
    expect(control.answerPermission).not.toHaveBeenCalled();
    expect(control.allowed).toEqual([]);
  });
});
