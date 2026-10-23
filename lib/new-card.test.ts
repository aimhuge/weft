import { beforeEach, describe, expect, it, vi } from "vitest";

// Making a card from a request body (POST /api/cards and the cloud inbox) and starting it.
//
// A card whose model or CLI is at its limit doesn't get its first turn now: it would come straight
// back as a rate-limit error. Its first message waits for the window to reset instead
// (lib/start-gate.ts), so startCard schedules it rather than starting a thread that dies.

vi.mock("./automations", () => ({ firstMessage: vi.fn((card: { prompt: string }) => card.prompt) }));
vi.mock("./folders", () => ({
  resolveFolder: vi.fn((cwd: unknown) => (typeof cwd === "string" ? cwd : "/dev/app")),
}));
vi.mock("./format", () => ({
  asText: vi.fn((v: unknown) => (typeof v === "string" ? v : "")),
  cleanTitle: vi.fn((v: string) => v.trim()),
  titleFromPrompt: vi.fn((p: string) => `Title: ${p}`),
}));
vi.mock("./model-fallback", () => ({ fallbackFor: vi.fn(() => undefined) }));
vi.mock("./runner", () => ({ sendMessage: vi.fn() }));
vi.mock("./scheduler", () => ({ scheduleMessage: vi.fn() }));
vi.mock("./settings", () => ({
  defaultPermissionMode: vi.fn(() => "auto"),
  touchProject: vi.fn(),
}));
vi.mock("./start-gate", () => ({ startGate: vi.fn(() => undefined) }));
vi.mock("./store", () => ({ createCard: vi.fn((body: Record<string, unknown>) => ({ id: "card-1", ...body })) }));
vi.mock("./tag-store", () => ({ rememberTags: vi.fn() }));
vi.mock("./tags", () => ({ normalizeTags: vi.fn((tags: string[]) => tags) }));

const automations = await import("./automations");
const folders = await import("./folders");
const fallback = await import("./model-fallback");
const runner = await import("./runner");
const scheduler = await import("./scheduler");
const gate = await import("./start-gate");
const store = await import("./store");
const { createCardFromBody, startCard } = await import("./new-card");

const card = { id: "card-1", prompt: "Add dark mode", backend: "claude", model: "opus" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gate.startGate).mockReturnValue(undefined);
  vi.mocked(fallback.fallbackFor).mockReturnValue(undefined);
});

describe("createCardFromBody", () => {
  it("needs a prompt", () => {
    expect(() => createCardFromBody({ prompt: "  " })).toThrow("Write a prompt for this thread.");
  });

  it("makes a card from the body", () => {
    const made = createCardFromBody({ prompt: "Add dark mode", cwd: "/dev/app", backend: "claude" });
    expect(store.createCard).toHaveBeenCalled();
    expect(made.id).toBe("card-1");
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({
      prompt: "Add dark mode",
      cwd: "/dev/app",
      backend: "claude",
    });
  });

  it("names the card from its prompt when no title is given", () => {
    createCardFromBody({ prompt: "Add dark mode" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ title: "Title: Add dark mode" });
  });

  it("keeps a title the user typed", () => {
    createCardFromBody({ prompt: "Add dark mode", title: "Dark mode" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ title: "Dark mode", titleBy: "user" });
  });

  it("falls back to Claude for an unknown CLI", () => {
    createCardFromBody({ prompt: "x", backend: "nope" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ backend: "claude" });
  });

  it("keeps a known CLI", () => {
    createCardFromBody({ prompt: "x", backend: "codex" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ backend: "codex" });
  });

  it("falls back to the default permission mode for an unknown one", () => {
    createCardFromBody({ prompt: "x", permissionMode: "nope" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ permissionMode: "auto" });
  });

  it("keeps a known permission mode", () => {
    createCardFromBody({ prompt: "x", permissionMode: "acceptEdits" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ permissionMode: "acceptEdits" });
  });

  it("drops a model whose id isn't a plain name", () => {
    createCardFromBody({ prompt: "x", model: "bad model id!" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ model: undefined });
  });

  it("keeps a plain model id", () => {
    createCardFromBody({ prompt: "x", model: "claude-opus-5-5" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ model: "claude-opus-5-5" });
  });

  it("starts on the backup model when the picked one is spent", () => {
    vi.mocked(fallback.fallbackFor).mockReturnValue({ backend: "puku", model: "puku-2" });
    createCardFromBody({ prompt: "x", backend: "claude", model: "opus" });
    expect(fallback.fallbackFor).toHaveBeenCalledWith("opus");
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ backend: "puku", model: "puku-2" });
  });

  it("starts on the picked model when nothing is spent", () => {
    createCardFromBody({ prompt: "x", backend: "claude", model: "opus" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ backend: "claude", model: "opus" });
  });

  it("resolves the folder the card runs in", () => {
    createCardFromBody({ prompt: "x", cwd: "/dev/app" });
    expect(folders.resolveFolder).toHaveBeenCalledWith("/dev/app");
  });

  it("keeps the tags it was given and remembers them", () => {
    createCardFromBody({ prompt: "x", tags: ["ui", "dark"] });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).toMatchObject({ tags: ["ui", "dark"], tagsBy: "user" });
  });

  it("has no tags when none were given", () => {
    createCardFromBody({ prompt: "x" });
    expect(vi.mocked(store.createCard).mock.calls[0]?.[0]).not.toHaveProperty("tags");
  });
});

describe("startCard", () => {
  it("sends the first turn when nothing is spent", () => {
    expect(startCard(card)).toEqual({ started: true });
    expect(runner.sendMessage).toHaveBeenCalledWith("card-1", "Add dark mode");
    expect(scheduler.scheduleMessage).not.toHaveBeenCalled();
  });

  it("waits for the reset when the model or CLI is at its limit", () => {
    const at = new Date(2026, 9, 24, 2, 30).getTime();
    vi.mocked(gate.startGate).mockReturnValue({ at, kind: "five_hour", subject: "claude" });

    expect(startCard(card)).toEqual({ started: false, at });
    expect(scheduler.scheduleMessage).toHaveBeenCalledWith("card-1", "Add dark mode", at);
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("asks the gate about the card's own model and CLI", () => {
    startCard(card);
    expect(gate.startGate).toHaveBeenCalledWith("claude", "opus");
  });

  it("sends the skills a start rule names", () => {
    vi.mocked(automations.firstMessage).mockReturnValueOnce("Add dark mode\n\nStart by using the dark-mode skill.");
    startCard(card);
    expect(runner.sendMessage).toHaveBeenCalledWith("card-1", "Add dark mode\n\nStart by using the dark-mode skill.");
  });
});
