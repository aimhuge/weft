// card.update on its own: every step of the PATCH body and the column move it can end with. The store is an
// in-memory Map; the runner, the automations and the agent and folder lookups are mocks.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));

vi.mock("@/lib/store", () => ({
  getCard: vi.fn((id: string) => db.cards.get(id)),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => Object.assign(db.cards.get(id)!, patch)),
  reorderCard: vi.fn(),
}));

vi.mock("@/lib/runner", () => ({
  sendMessage: vi.fn(),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  endSession: vi.fn(() => Promise.resolve()),
  isBusy: vi.fn(() => false),
  setPermissionMode: vi.fn(),
}));

vi.mock("@/lib/automations", () => ({
  firstMessage: vi.fn(() => "first"),
  messagesForMove: vi.fn((_card: Card, column: string) => [`/move-${column}`]),
  doneOverrides: vi.fn(() => ({})),
}));

vi.mock("@/lib/agent-store", () => ({ listAgents: vi.fn(() => [{ id: "builder" }, { id: "copywriter" }]) }));
vi.mock("@/lib/card-repoint", () => ({ repointCard: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/folders", () => ({ resolveFolder: vi.fn((raw: string) => `/resolved${raw}`) }));
vi.mock("@/lib/tag-store", () => ({ rememberTags: vi.fn() }));
vi.mock("@/lib/skill-set-actions", () => ({
  isSkillName: (name: unknown) => typeof name === "string" && /^[\w.@:-]+$/.test(name),
  setCardSkill: vi.fn(() => Promise.resolve(undefined)),
}));

const runner = await import("@/lib/runner");
const store = await import("@/lib/store");
const automations = await import("@/lib/automations");
const repoint = await import("@/lib/card-repoint");
const tagStore = await import("@/lib/tag-store");
const { updateCardVerb } = await import("./card-update");
const { NotFound } = await import("./types");

function addCard(patch: Partial<Card> = {}): Card {
  const card = { id: "c1", title: "t", prompt: "p", cwd: "/repo", column: "review", createdAt: 1, updatedAt: 1, ...patch } as Card;
  db.cards.set(card.id, card);
  return card;
}
const update = (body: object, id = "c1") => updateCardVerb({ id, body });

beforeEach(() => {
  db.cards.clear();
  vi.clearAllMocks();
  vi.mocked(runner.isBusy).mockReturnValue(false);
  vi.mocked(automations.doneOverrides).mockReturnValue({});
});

describe("card.update", () => {
  it("refuses a card that isn't there with NotFound", async () => {
    await expect(update({})).rejects.toBeInstanceOf(NotFound);
  });

  it("turns one skill on or off for the card alone, as the host's skill set has it", async () => {
    const { setCardSkill } = await import("@/lib/skill-set-actions");
    addCard();
    await update({ skill: { name: "ship", on: false } });
    expect(setCardSkill).toHaveBeenCalledWith("c1", "ship", false);
    await expect(update({ skill: { name: "../etc", on: true } })).rejects.toThrow("That skill change names no skill.");
    await expect(update({ skill: { name: "ship" } })).rejects.toThrow("That skill change names no skill.");
    await expect(update({ skill: "ship" })).rejects.toThrow("That skill change names no skill.");
    addCard({ id: "pilot", role: "copilot" });
    await expect(update({ skill: { name: "ship", on: true } }, "pilot")).rejects.toThrow("The copilot's skills aren't set per card.");
    expect(setCardSkill).toHaveBeenCalledTimes(1);
  });

  it("returns the card, and leaves it alone for an empty body", async () => {
    addCard();
    await expect(update({})).resolves.toEqual({ card: db.cards.get("c1") });
    expect(store.updateCard).not.toHaveBeenCalled();
    expect(store.reorderCard).not.toHaveBeenCalled();
  });

  it("retitles as yours, but not to an empty title", async () => {
    addCard();
    await update({ title: "  New  " });
    expect(db.cards.get("c1")).toMatchObject({ title: "New", titleBy: "user" });
    await update({ title: "   " });
    expect(db.cards.get("c1")!.title).toBe("New");
  });

  it("archives, but never the copilot", async () => {
    addCard();
    await update({ archived: 1 });
    expect(db.cards.get("c1")!.archived).toBe(true);
    addCard({ role: "copilot" });
    await expect(update({ archived: true })).rejects.toThrow("The copilot isn't on the board.");
  });

  it("stars, clears the Broke mark and sets tags as yours", async () => {
    addCard({ broke: { kind: "server", at: 1, why: "w" } });
    await update({ starred: "yes", broke: null, tags: [" Bug ", "#UI"] });
    expect(db.cards.get("c1")).toMatchObject({ starred: true, broke: undefined, tags: ["bug", "ui"], tagsBy: "user" });
    expect(tagStore.rememberTags).toHaveBeenCalledWith(["bug", "ui"]);
    await expect(update({ tags: "bug" })).rejects.toThrow("Tags must be a list.");
  });

  it("grants a read scope, refusing an empty one and the copilot", async () => {
    addCard({ readScope: ["/old"] });
    await update({ readScope: "/elsewhere" });
    expect(db.cards.get("c1")!.readScope).toEqual(["/old", "/elsewhere"]);
    await expect(update({ readScope: "" })).rejects.toThrow("readScope must be a non-empty path.");
    await expect(update({ readScope: 3 })).rejects.toThrow("readScope must be a non-empty path.");
    addCard({ role: "copilot" });
    await expect(update({ readScope: "/x" })).rejects.toThrow("The copilot doesn't read from project folders.");
  });

  it("allows safe SQL on the card, clears it on false and refuses a non-boolean", async () => {
    addCard();
    await update({ safeSql: true });
    expect(db.cards.get("c1")!.safeSql).toBe(true);
    await update({ safeSql: false });
    expect(db.cards.get("c1")!.safeSql).toBeUndefined();
    expect(store.updateCard).toHaveBeenLastCalledWith("c1", { safeSql: undefined });
    await expect(update({ safeSql: "yes" })).rejects.toThrow("safeSql must be true or false.");
    await expect(update({ safeSql: null })).rejects.toThrow("safeSql must be true or false.");
    expect(store.updateCard).toHaveBeenCalledTimes(2);
  });

  it("sets the permission mode after checking it", async () => {
    addCard();
    await update({ permissionMode: "auto" });
    expect(runner.setPermissionMode).toHaveBeenCalledWith("c1", "auto");
    await expect(update({ permissionMode: "yolo" })).rejects.toThrow("Unknown permission mode.");
    addCard({ backend: "codex", sessionId: "s", permissionMode: "default" });
    await expect(update({ permissionMode: "auto" })).rejects.toThrow("Codex keeps its sandbox mode");
    await update({ permissionMode: "default" });
    addCard({ backend: "puku" });
    await expect(update({ permissionMode: "bypassPermissions" })).rejects.toThrow("This thread can't skip permission prompts.");
    addCard({ role: "copilot" });
    await expect(update({ permissionMode: "bypassPermissions" })).rejects.toThrow("This thread can't skip permission prompts.");
    addCard();
    await update({ permissionMode: "bypassPermissions" });
    expect(runner.setPermissionMode).toHaveBeenLastCalledWith("c1", "bypassPermissions");
  });

  it("switches the agent through repointCard, and only when it changes", async () => {
    addCard();
    await update({ agent: "copywriter" });
    expect(repoint.repointCard).toHaveBeenCalledWith(db.cards.get("c1"), { agent: "copywriter" }, "Stop the thread before switching its agent.", expect.anything());
    vi.mocked(repoint.repointCard).mockClear();
    addCard({ agent: "copywriter" });
    await update({ agent: "copywriter" });
    expect(repoint.repointCard).not.toHaveBeenCalled();
    await expect(update({ agent: "nobody" })).rejects.toThrow("Unknown agent.");
    addCard({ role: "copilot" });
    await expect(update({ agent: "builder" })).rejects.toThrow("The copilot picks a persona, not an agent.");
  });

  it("re-points the folder, but not while the thread runs", async () => {
    addCard({ error: "gone" });
    await update({ cwd: "/moved" });
    expect(db.cards.get("c1")).toMatchObject({ cwd: "/resolved/moved", error: undefined });
    vi.mocked(runner.isBusy).mockReturnValue(true);
    await expect(update({ cwd: "/x" })).rejects.toThrow("Stop the thread before moving its folder.");
  });

  it("reorders before a sibling or to the end, and refuses anything else", async () => {
    addCard();
    await update({ before: "c2" });
    expect(store.reorderCard).toHaveBeenLastCalledWith("c1", "c2");
    await update({ before: null });
    expect(store.reorderCard).toHaveBeenLastCalledWith("c1", null);
    await expect(update({ before: 5 })).rejects.toThrow("before must be a card id or null.");
  });

  it("applies the steps in the PATCH's order: title before a failing mode", async () => {
    addCard();
    await expect(update({ title: "Kept", permissionMode: "nope" })).rejects.toThrow("Unknown permission mode.");
    expect(db.cards.get("c1")!.title).toBe("Kept");
  });
});

describe("card.update's column move", () => {
  it("does nothing for the card's own column", async () => {
    addCard();
    await update({ column: "review" });
    expect(runner.queueMessages).not.toHaveBeenCalled();
  });

  it("refuses an unknown column, the copilot and a busy thread", async () => {
    addCard();
    await expect(update({ column: "nowhere" })).rejects.toThrow("Unknown column.");
    addCard({ role: "copilot" });
    await expect(update({ column: "done" })).rejects.toThrow("The copilot isn't on the board.");
    addCard();
    vi.mocked(runner.isBusy).mockReturnValue(true);
    await expect(update({ column: "done" })).rejects.toThrow("Stop the thread before moving it.");
  });

  it("parks a busy card that waits on you", async () => {
    addCard({ pending: { id: "p" } } as Partial<Card>);
    vi.mocked(runner.isBusy).mockReturnValue(true);
    await update({ column: "backlog" });
    expect(db.cards.get("c1")).toMatchObject({ column: "backlog", archived: false });
    expect(runner.queueMessages).toHaveBeenCalledWith("c1", ["/move-backlog"]);
  });

  it("runs a Backlog card's first message, and only from Backlog", async () => {
    addCard({ column: "backlog" });
    await update({ column: "running" });
    expect(runner.sendMessage).toHaveBeenCalledWith("c1", "first");
    addCard({ column: "review" });
    await expect(update({ column: "running" })).rejects.toThrow("Reply in the thread to run it again.");
  });

  it("never moves a card to Needs you by hand", async () => {
    addCard();
    await expect(update({ column: "needs_you" })).rejects.toThrow("Cards move to Needs you on their own.");
  });

  it("files a Done card away once its automations run, without an override", async () => {
    addCard();
    await update({ column: "done" });
    expect(runner.archiveWhenIdle).toHaveBeenCalledWith("c1");
    expect(db.cards.get("c1")!.preDoneModel).toBeUndefined();
  });

  it("snapshots the card's picks for a /weft:done override", async () => {
    addCard({ model: "m", effort: "low", backend: "claude", sessionId: "s" });
    vi.mocked(automations.doneOverrides).mockReturnValue({ model: "m2", effort: "high", backend: "puku" });
    await update({ column: "done" });
    expect(db.cards.get("c1")).toMatchObject({
      preDoneModel: "m", preDoneEffort: "low", preDoneBackend: "claude", model: "m2", effort: "high", backend: "puku", sessionId: undefined,
    });
  });

  it("snapshots only what the override sets", async () => {
    addCard({ model: "m", effort: "low", backend: "claude", sessionId: "s" });
    vi.mocked(automations.doneOverrides).mockReturnValue({ effort: "high" });
    await update({ column: "done" });
    expect(db.cards.get("c1")).toMatchObject({ preDoneModel: "m", preDoneEffort: "low", model: "m", effort: "high", backend: "claude", sessionId: "s" });
    expect(db.cards.get("c1")!.preDoneBackend).toBeUndefined();
    addCard({ model: "m", effort: "low" });
    vi.mocked(automations.doneOverrides).mockReturnValue({ model: "m2" });
    await update({ column: "done" });
    expect(db.cards.get("c1")).toMatchObject({ preDoneModel: "m", model: "m2", effort: "low" });
  });
});
