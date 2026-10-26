import { beforeEach, describe, expect, it, vi } from "vitest";

// The Settings route's validation of the rows the settings dialog didn't cover on its own: the
// backup model (the banner's rerun), the Goose provider and its two free-text rows, and the
// default CLI. Each one refuses a value it can't honour with a 400 before any setter runs.

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-api-test-data",
  listCards: vi.fn(() => []),
  getCard: vi.fn(),
}));

vi.mock("@/lib/runner", () => ({ freeSlots: vi.fn() }));

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
  setGooseProviderId: vi.fn(),
  setGooseModelId: vi.fn(),
  setGooseBaseUrl: vi.fn(),
  gooseProviderId: vi.fn(() => ""),
  gooseModelId: vi.fn(() => ""),
  gooseBaseUrl: vi.fn(() => ""),
  settingsView: vi.fn(() => ({ threadPrompt: "tp", keepAliveMinutes: 5, automations: [] })),
}));

const settings = await import("@/lib/settings");
const settingsRoute = await import("./settings/route");

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

describe("/settings: the backup model", () => {
  it("takes any model a CLI serves, and '' to turn the rerun off", async () => {
    expect((await patch({ backupModel: "claude-opus-5-5" })).status).toBe(200);
    expect(settings.setBackupModel).toHaveBeenCalledWith("claude-opus-5-5");
    vi.mocked(settings.setBackupModel).mockClear();
    expect((await patch({ backupModel: "" })).status).toBe(200);
    expect(settings.setBackupModel).toHaveBeenCalledWith("");
  });

  it("refuses a model no CLI serves", async () => {
    expect((await patch({ backupModel: "not-a-model" })).status).toBe(400);
    expect(settings.setBackupModel).not.toHaveBeenCalled();
  });

  it("refuses a backup model that isn't text", async () => {
    expect((await patch({ backupModel: 7 })).status).toBe(400);
    expect(settings.setBackupModel).not.toHaveBeenCalled();
  });
});

describe("/settings: the Goose rows", () => {
  it("takes a provider from the catalog, and '' for none", async () => {
    expect((await patch({ gooseProviderId: "openrouter" })).status).toBe(200);
    expect(settings.setGooseProviderId).toHaveBeenCalledWith("openrouter");
    vi.mocked(settings.setGooseProviderId).mockClear();
    expect((await patch({ gooseProviderId: "" })).status).toBe(200);
    expect(settings.setGooseProviderId).toHaveBeenCalledWith("");
  });

  it("refuses a provider the catalog doesn't know", async () => {
    expect((await patch({ gooseProviderId: "nope" })).status).toBe(400);
    expect(settings.setGooseProviderId).not.toHaveBeenCalled();
  });

  it("refuses a Goose provider that isn't text", async () => {
    expect((await patch({ gooseProviderId: 7 })).status).toBe(400);
    expect(settings.setGooseProviderId).not.toHaveBeenCalled();
  });

  it("takes a free-text Goose model id and endpoint", async () => {
    expect((await patch({ gooseModelId: "anthropic/claude-sonnet-4.5" })).status).toBe(200);
    expect(settings.setGooseModelId).toHaveBeenCalledWith("anthropic/claude-sonnet-4.5");
    expect((await patch({ gooseBaseUrl: "https://api.example.com/v1" })).status).toBe(200);
    expect(settings.setGooseBaseUrl).toHaveBeenCalledWith("https://api.example.com/v1");
  });

  it("refuses a Goose model id or endpoint that isn't text", async () => {
    expect((await patch({ gooseModelId: 7 })).status).toBe(400);
    expect((await patch({ gooseBaseUrl: 7 })).status).toBe(400);
    expect(settings.setGooseModelId).not.toHaveBeenCalled();
    expect(settings.setGooseBaseUrl).not.toHaveBeenCalled();
  });
});

describe("/settings: the default CLI", () => {
  it("takes any CLI Weft can start a thread on", async () => {
    for (const backend of ["claude", "puku", "codex", "goose"]) {
      expect((await patch({ defaultBackend: backend })).status, backend).toBe(200);
      expect(settings.setDefaultBackend).toHaveBeenCalledWith(backend);
      vi.mocked(settings.setDefaultBackend).mockClear();
    }
  });

  it("refuses a CLI Weft can't start a thread on", async () => {
    expect((await patch({ defaultBackend: "nope" })).status).toBe(400);
    expect(settings.setDefaultBackend).not.toHaveBeenCalled();
  });
});

describe("/settings: the guard", () => {
  it("refuses a read from another host", async () => {
    const res = await settingsRoute.GET(req("/settings", { headers: { ...WRITE, host: "evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("refuses a write without the token", async () => {
    const res = await settingsRoute.PATCH(req("/settings", { method: "PATCH", body: { keepAliveMinutes: 5 }, headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(403);
  });
});

describe("/settings: the automations", () => {
  it("refuses a rule that is nothing at all", async () => {
    expect((await patch({ automations: [null] })).status).toBe(400);
    expect(settings.setAutomations).not.toHaveBeenCalled();
  });
});
