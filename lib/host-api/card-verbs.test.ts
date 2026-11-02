// The card verbs other than card.update, each on its own: stop, a task's stop, "!" shell, Send fresh, the reply
// variants, the permission answers and the CLI switches. Everything they call into is a mock.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));

vi.mock("@/lib/store", () => ({ getCard: vi.fn((id: string) => db.cards.get(id)) }));
vi.mock("@/lib/runner", () => ({
  stop: vi.fn(() => Promise.resolve()),
  sendUserMessage: vi.fn(),
  editLastMessage: vi.fn(() => Promise.resolve()),
  answerPermission: vi.fn(),
  waitPermission: vi.fn(),
  switchBackend: vi.fn(() => Promise.resolve()),
  rerunOnModel: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/task-stop", () => ({ stopTask: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/shell", () => ({ runShell: vi.fn(() => 1) }));
vi.mock("@/lib/splice", () => ({ sendFresh: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/copilot", () => ({ sendToCopilot: vi.fn() }));
vi.mock("@/lib/restart", () => ({ restartTurn: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/precedence", () => ({ putFirst: vi.fn(), putHolderFirst: vi.fn() }));
vi.mock("@/lib/new-thread", () => ({
  BACKEND_IDS: ["claude", "codex"],
  MODELS: { claude: [{ id: "opus" }], codex: [{ id: "codex-default" }] },
  NO_MODEL: "",
  ALL_MODEL_IDS: new Set(["opus", "codex-default"]),
  backendFor: vi.fn((model: string) => (model === "opus" ? "claude" : undefined)),
}));

const runner = await import("@/lib/runner");
const taskStop = await import("@/lib/task-stop");
const shell = await import("@/lib/shell");
const splice = await import("@/lib/splice");
const copilot = await import("@/lib/copilot");
const restart = await import("@/lib/restart");
const precedence = await import("@/lib/precedence");
const { stopCard } = await import("./card-stop");
const { stopTaskVerb } = await import("./card-task");
const { shellCommand } = await import("./card-shell");
const { sendFreshVerb } = await import("./card-fresh");
const { sendMessageVerb, editMessageVerb, restartVerb } = await import("./card-messages");
const { answerVerb, putFirstVerb, putOtherFirstVerb, waitVerb } = await import("./card-permission");
const { switchBackendVerb, rerunModelVerb } = await import("./card-cli");
const { NotFound } = await import("./types");

const OK = { ok: true };

beforeEach(() => {
  db.cards.clear();
  db.cards.set("c1", { id: "c1", column: "review" } as Card);
  vi.clearAllMocks();
});

describe("run controls", () => {
  it("stops the card and one of its tasks", async () => {
    await expect(stopCard({ id: "c1" })).resolves.toEqual(OK);
    expect(runner.stop).toHaveBeenCalledWith("c1");
    await expect(stopTaskVerb({ id: "c1", taskId: "t1" })).resolves.toEqual(OK);
    expect(taskStop.stopTask).toHaveBeenCalledWith("c1", "t1");
  });

  it("runs a trimmed shell command, or an empty one", async () => {
    await expect(shellCommand({ id: "c1", command: "  ls  " })).resolves.toEqual(OK);
    expect(shell.runShell).toHaveBeenLastCalledWith("c1", "ls");
    await shellCommand({ id: "c1" });
    expect(shell.runShell).toHaveBeenLastCalledWith("c1", "");
  });

  it("sends fresh with the message, or an empty one", async () => {
    await expect(sendFreshVerb({ id: "c1", message: "hi" })).resolves.toEqual(OK);
    expect(splice.sendFresh).toHaveBeenLastCalledWith("c1", "hi");
    await sendFreshVerb({ id: "c1" });
    expect(splice.sendFresh).toHaveBeenLastCalledWith("c1", "");
  });
});

describe("messages", () => {
  it("sends a trimmed reply to the card, or to the copilot", async () => {
    await expect(sendMessageVerb({ id: "c1", text: " hi " })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(runner.sendUserMessage).toHaveBeenCalledWith("c1", "hi");
    await sendMessageVerb({ id: "copilot", text: "yo" });
    expect(copilot.sendToCopilot).toHaveBeenCalledWith("yo");
  });

  it("refuses an empty reply or edit", async () => {
    await expect(sendMessageVerb({ id: "c1", text: "  " })).rejects.toThrow("Write a message first.");
    await expect(editMessageVerb({ id: "c1" })).rejects.toThrow("Write a message first.");
  });

  it("edits the last message and restarts the turn", async () => {
    await expect(editMessageVerb({ id: "c1", text: " new " })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(runner.editLastMessage).toHaveBeenCalledWith("c1", "new");
    await expect(restartVerb({ id: "c1" })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(restart.restartTurn).toHaveBeenCalledWith("c1");
  });
});

describe("permission answers", () => {
  it("puts this card or the holder first, and waits, each needing the pendingId", async () => {
    await expect(putFirstVerb({ id: "c1", pendingId: "p" })).resolves.toEqual(OK);
    expect(precedence.putFirst).toHaveBeenCalledWith("c1", "p");
    await expect(putOtherFirstVerb({ id: "c1", pendingId: "p" })).resolves.toEqual(OK);
    expect(precedence.putHolderFirst).toHaveBeenCalledWith("c1", "p");
    await expect(waitVerb({ id: "c1", pendingId: "p" })).resolves.toEqual(OK);
    expect(runner.waitPermission).toHaveBeenCalledWith("c1", "p");
    await expect(putFirstVerb({ id: "c1", pendingId: 1 })).rejects.toThrow("This first needs the request's pendingId.");
    await expect(putOtherFirstVerb({ id: "c1", pendingId: undefined })).rejects.toThrow("Others first needs the request's pendingId.");
    await expect(waitVerb({ id: "c1", pendingId: null })).rejects.toThrow("Wait needs the request's pendingId.");
  });

  it("answers with the answers, the pendingId and the question's reply", async () => {
    await expect(answerVerb({ id: "c1", allow: true, answers: { q: "a" }, pendingId: "p", chat: "talk" })).resolves.toEqual(OK);
    expect(runner.answerPermission).toHaveBeenLastCalledWith("c1", true, { q: "a" }, "p", { chat: "talk" });
  });

  it("answers no for anything but allow: true, dropping malformed fields", async () => {
    await answerVerb({ id: "c1", answers: "x", pendingId: 5 });
    expect(runner.answerPermission).toHaveBeenLastCalledWith("c1", false, undefined, undefined, undefined);
  });
});

describe("CLI switches", () => {
  it("refuses a card that isn't there", async () => {
    await expect(switchBackendVerb({ id: "nope", backend: "claude" })).rejects.toBeInstanceOf(NotFound);
    await expect(rerunModelVerb({ id: "nope", model: "opus" })).rejects.toBeInstanceOf(NotFound);
  });

  it("switches the CLI, with a model it serves, the no-model choice or none", async () => {
    await expect(switchBackendVerb({ id: "c1", backend: "claude", model: "opus", replay: true })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(runner.switchBackend).toHaveBeenLastCalledWith("c1", "claude", { replay: true, model: "opus" });
    await switchBackendVerb({ id: "c1", backend: "codex", model: "" });
    expect(runner.switchBackend).toHaveBeenLastCalledWith("c1", "codex", { replay: false, model: "" });
    await switchBackendVerb({ id: "c1", backend: "codex" });
    expect(runner.switchBackend).toHaveBeenLastCalledWith("c1", "codex", { replay: false, model: undefined });
  });

  it("refuses an unknown CLI and a model from another one", async () => {
    await expect(switchBackendVerb({ id: "c1", backend: "vim" })).rejects.toThrow("backend must be one of claude, codex.");
    await expect(switchBackendVerb({ id: "c1", backend: 3 })).rejects.toThrow("backend must be one of claude, codex.");
    await expect(switchBackendVerb({ id: "c1", backend: "codex", model: "opus" })).rejects.toThrow("opus isn't a codex model.");
    await expect(switchBackendVerb({ id: "c1", backend: "codex", model: 7 })).rejects.toThrow("That isn't a codex model.");
  });

  it("reruns on a model any CLI serves, and refuses anything else", async () => {
    await expect(rerunModelVerb({ id: "c1", model: "opus" })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(runner.rerunOnModel).toHaveBeenLastCalledWith("c1", "opus");
    await rerunModelVerb({ id: "c1", model: "codex-default" });
    expect(runner.rerunOnModel).toHaveBeenLastCalledWith("c1", "codex-default");
    await expect(rerunModelVerb({ id: "c1", model: "" })).rejects.toThrow("model must be a non-empty string.");
    await expect(rerunModelVerb({ id: "c1", model: 1 })).rejects.toThrow("model must be a non-empty string.");
    await expect(rerunModelVerb({ id: "c1", model: "gpt" })).rejects.toThrow("gpt isn't a model any installed CLI serves.");
  });
});
