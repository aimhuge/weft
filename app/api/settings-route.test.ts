import { beforeEach, describe, expect, it, vi } from "vitest";

// The Settings route: the thread prompt, keep-alive, permission mode and the automations, plus
// every model pick. Every model any CLI serves is accepted for the model rows (New threads, use
// for subagents, the copilot, Review all, /weft:done on, the backup) — picking one moves the card
// to the CLI that serves it, so the API takes them all.

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-api-test-data",
  listCards: vi.fn(() => []),
  getCard: vi.fn(),
}));

vi.mock("@/lib/automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/automations")>()),
  doneOverrides: vi.fn(() => ({})),
}));

const freeSlots = vi.fn();
vi.mock("@/lib/runner", () => ({ freeSlots }));

vi.mock("@/lib/settings", () => ({
  DEFAULT_THREAD_PROMPT: "You are a card on a board.",
  listProjects: vi.fn(() => []),
  touchProject: vi.fn(),
  removeProject: vi.fn(),
  dismissSession: vi.fn(),
  dismissedSessions: vi.fn(() => []),
  threadPrompt: vi.fn(() => "tp"),
  setThreadPrompt: vi.fn(),
  keepAliveMinutes: vi.fn(() => 5),
  setKeepAliveMinutes: vi.fn(),
  MAX_THREADS_CEILING: 50,
  setMaxThreads: vi.fn(),
  defaultPermissionMode: vi.fn(() => "auto"),
  setDefaultPermissionMode: vi.fn(),
  defaultBackend: vi.fn(() => "claude"),
  setDefaultBackend: vi.fn(),
  automations: vi.fn(() => []),
  setAutomations: vi.fn(),
  pushOnDone: vi.fn(() => true),
  setPushOnDone: vi.fn(),
  subagentModel: vi.fn(() => "choose"),
  setSubagentModel: vi.fn(),
  doneModel: vi.fn(() => ""),
  doneEffort: vi.fn(() => ""),
  setDoneModel: vi.fn(),
  setDoneEffort: vi.fn(),
  copilotModel: vi.fn(() => ""),
  setCopilotModel: vi.fn(),
  reviewAllModel: vi.fn(() => ""),
  setReviewAllModel: vi.fn(),
  backupModel: vi.fn(() => ""),
  setBackupModel: vi.fn(),
  issueFolders: vi.fn(() => []),
  setIssueSync: vi.fn(),
  allowedFolders: vi.fn(() => []),
  allowFolder: vi.fn(),
  unallowFolder: vi.fn(),
  syncFolders: vi.fn(() => []),
  setSyncFolder: vi.fn(),
  settingsView: vi.fn(() => ({ threadPrompt: "tp", keepAliveMinutes: 5, automations: [] })),
}));

vi.mock("@/lib/goose-models", () => ({ setNamedModels: vi.fn() }));

const settings = await import("@/lib/settings");
const settingsRoute = await import("./settings/route");
const gooseModels = await import("@/lib/goose-models");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const patch = (body: unknown) => settingsRoute.PATCH(req("/settings", { method: "PATCH", body }));

beforeEach(() => vi.clearAllMocks());

describe("/settings", () => {
  it("GET returns the settings view", async () => {
    expect(await (await settingsRoute.GET(req("/settings"))).json()).toEqual({ threadPrompt: "tp", keepAliveMinutes: 5, automations: [] });
  });

  it("PATCH saves the prompt, keep-alive, default mode, push on Done and automations", async () => {
    const res = await patch({
      threadPrompt: "be brief",
      pushOnDone: false,
      subagentModel: "opus-4.8",
      doneModel: "claude-opus-5-5", doneEffort: "xhigh", copilotModel: "claude-haiku-5-5", reviewAllModel: "claude-sonnet-5-5",
      keepAliveMinutes: 10,
      defaultPermissionMode: "acceptEdits",
      automations: [
        { id: "a1", on: "done", skill: "/weft:done" },
        { on: "prompt-matches", skill: "deploy", pattern: "ship it" },
      ],
    });
    expect(res.status).toBe(200);
    expect(settings.setThreadPrompt).toHaveBeenCalledWith("be brief");
    expect(settings.setKeepAliveMinutes).toHaveBeenCalledWith(10);
    expect(settings.setDefaultPermissionMode).toHaveBeenCalledWith("acceptEdits");
    expect(settings.setPushOnDone).toHaveBeenCalledWith(false);
    expect(settings.setSubagentModel).toHaveBeenCalledWith("opus-4.8");
    expect(settings.setDoneModel).toHaveBeenCalledWith("claude-opus-5-5");
    expect(settings.setDoneEffort).toHaveBeenCalledWith("xhigh");
    expect([vi.mocked(settings.setCopilotModel).mock.calls[0], vi.mocked(settings.setReviewAllModel).mock.calls[0]]).toEqual([["claude-haiku-5-5"], ["claude-sonnet-5-5"]]);
    const [rules] = vi.mocked(settings.setAutomations).mock.calls[0]!;
    expect(rules[0]).toEqual({ id: "a1", on: "done", skill: "weft:done" });
    expect(rules[1]).toMatchObject({ on: "prompt-matches", skill: "deploy", pattern: "ship it" });
    expect(rules[1]!.id).toBeTruthy();
  });

  it("PATCH saves the cap on running threads, then lets the waiting threads go", async () => {
    expect((await patch({ maxThreads: 3 })).status).toBe(200);
    expect(settings.setMaxThreads).toHaveBeenCalledWith(3);
    expect(freeSlots).toHaveBeenCalled();
    vi.mocked(settings.setMaxThreads).mockClear();
    expect((await patch({ maxThreads: 0 })).status).toBe(200);
    expect(settings.setMaxThreads).toHaveBeenCalledWith(0);
  });

  it("PATCH rejects bad values with 400 and saves nothing", async () => {
    for (const body of [
      { threadPrompt: 5 },
      { keepAliveMinutes: -1 },
      { keepAliveMinutes: "10" },
      { maxThreads: -1 },
      { maxThreads: 2.5 },
      { maxThreads: 51 },
      { maxThreads: "4" },
      { defaultPermissionMode: "yolo" },
      { pushOnDone: "no" },
      { subagentModel: "gpt-5" },
      { doneModel: "gpt-5" },
      { doneEffort: "extreme" },
      // A model no CLI serves. Any model a CLI does serve is fine for these rows now.
      { copilotModel: "not-a-model" }, { reviewAllModel: "not-a-model" },
      { automations: "nope" },
      { automations: [{ on: "sometimes", skill: "x" }] },
      { automations: [{ on: "done", skill: "bad skill!" }] },
      { automations: [{ on: "prompt-matches", skill: "x" }] },
      { automations: [{ on: "prompt-matches", skill: "x", pattern: "(" }] },
      { threadPrompt: "ok", automations: [{ on: "nope" }] },
      "{",
    ]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(settings.setThreadPrompt).not.toHaveBeenCalled();
    expect(settings.setKeepAliveMinutes).not.toHaveBeenCalled();
    expect(settings.setDefaultPermissionMode).not.toHaveBeenCalled();
    expect(settings.setAutomations).not.toHaveBeenCalled();
    expect(settings.setPushOnDone).not.toHaveBeenCalled();
    expect(settings.setSubagentModel).not.toHaveBeenCalled();
  });

  it("PATCH takes any model a CLI serves, from any CLI", async () => {
    for (const body of [
      { copilotModel: "opus-4.8" },
      { copilotModel: "puku-ai-2.8" },
      { reviewAllModel: "claude-opus-5-5" },
      { reviewAllModel: "puku-ai-2.7" },
      { subagentModel: "puku-ai-2.8" },
      { doneModel: "claude-sonnet-5-5" },
    ]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(200);
    }
    expect(settings.setCopilotModel).toHaveBeenCalledWith("puku-ai-2.8");
    expect(settings.setReviewAllModel).toHaveBeenCalledWith("puku-ai-2.7");
    expect(settings.setSubagentModel).toHaveBeenCalledWith("puku-ai-2.8");
  });

  it("PATCH saves the names the user gave their Goose models", async () => {
    const res = await patch({
      gooseNamedModels: [
        { id: "puku-ai-2.8", name: "My Puku" },
        { id: "anthropic/claude-opus-4.1", name: "Big Opus" },
      ],
    });
    expect(res.status).toBe(200);
    expect(gooseModels.setNamedModels).toHaveBeenCalledWith([
      { id: "puku-ai-2.8", name: "My Puku" },
      { id: "anthropic/claude-opus-4.1", name: "Big Opus" },
    ]);
  });

  it("PATCH leaves the names alone when the field isn't in the body", async () => {
    expect((await patch({ threadPrompt: "be brief" })).status).toBe(200);
    expect(gooseModels.setNamedModels).not.toHaveBeenCalled();
  });

  it("PATCH refuses a list of names that isn't a list of pairs, and saves none of them", async () => {
    for (const body of [
      { gooseNamedModels: "nope" },
      { gooseNamedModels: ["just-a-string"] },
      { gooseNamedModels: [{ id: "gpt-5" }] },
      { gooseNamedModels: [{ name: "No id" }] },
      { gooseNamedModels: [{ id: 5, name: "A number" }] },
      { gooseNamedModels: [null] },
    ]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(gooseModels.setNamedModels).not.toHaveBeenCalled();
  });
});
