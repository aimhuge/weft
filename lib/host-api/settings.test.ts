import { beforeEach, describe, expect, it, vi } from "vitest";

// settings.get / settings.put: a host's own settings, and the waiting threads let go when the cap rises.
const state = vi.hoisted(() => ({ maxThreads: 6 }));
vi.mock("@/lib/host-settings", () => ({
  hostSettings: vi.fn(() => ({ maxThreads: state.maxThreads, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" })),
  applyHostSettings: vi.fn((patch: { maxThreads?: number }) => {
    if (patch.maxThreads !== undefined) state.maxThreads = patch.maxThreads;
    return { maxThreads: state.maxThreads, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" };
  }),
}));
vi.mock("@/lib/runner", () => ({ freeSlots: vi.fn() }));

const runner = await import("@/lib/runner");
const { settingsGetVerb, settingsPutVerb } = await import("./settings");

beforeEach(() => {
  state.maxThreads = 6;
  vi.clearAllMocks();
});

describe("host settings verbs", () => {
  it("reads the host's settings", async () => {
    await expect(settingsGetVerb()).resolves.toEqual({ settings: { maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" } });
  });

  it("saves a patch, and frees slots only when the cap changed", async () => {
    await expect(settingsPutVerb({ patch: { keepAliveMinutes: 0 } })).resolves.toMatchObject({ settings: { maxThreads: 6 } });
    expect(runner.freeSlots).not.toHaveBeenCalled();
    await expect(settingsPutVerb({ patch: { maxThreads: 9 } })).resolves.toMatchObject({ settings: { maxThreads: 9 } });
    expect(runner.freeSlots).toHaveBeenCalledTimes(1);
  });
});
