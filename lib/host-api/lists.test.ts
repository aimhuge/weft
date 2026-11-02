import { beforeEach, describe, expect, it, vi } from "vitest";

const updateCron = vi.hoisted(() => vi.fn((id: string, patch: object) => ({ id, ...patch })));
const deleteCron = vi.hoisted(() => vi.fn());
vi.mock("../crons", () => ({ updateCron, deleteCron }));
const runCron = vi.hoisted(() => vi.fn((id: string) => Promise.resolve({ id: `run-of-${id}` })));
vi.mock("../cron-run", () => ({ runCron }));
const updateWebhook = vi.hoisted(() => vi.fn((id: string, patch: object) => ({ id, ...patch })));
const removeWebhook = vi.hoisted(() => vi.fn<(id: string) => object | undefined>(() => ({ id: "h1" })));
vi.mock("../webhooks", () => ({ updateWebhook, removeWebhook }));

const { cronDeleteVerb, cronRunVerb, cronUpdateVerb, NO_HOOK, webhookDeleteVerb, webhookUpdateVerb } = await import("./lists");

beforeEach(() => vi.clearAllMocks());

describe("the crons and webhooks a host keeps", () => {
  it("changes, deletes and runs a cron", async () => {
    expect(await cronUpdateVerb({ id: "k1", patch: { enabled: false } })).toEqual({ cron: { id: "k1", enabled: false } });
    expect(await cronDeleteVerb({ id: "k1" })).toEqual({ ok: true });
    expect(deleteCron).toHaveBeenCalledWith("k1");
    expect(await cronUpdateVerb({ id: "k1", patch: { prompt: "p" }, permissionMode: "default" })).toEqual({ cron: { id: "k1", prompt: "p", permissionMode: "default" } });
    expect(await cronRunVerb({ id: "k1" })).toEqual({ card: { id: "run-of-k1" } });
    expect(runCron).toHaveBeenLastCalledWith("k1", expect.any(Number), undefined);
  });

  it("runs a cron in the mode the host allows, when it names one", async () => {
    await cronRunVerb({ id: "k1", permissionMode: "default" });
    expect(runCron).toHaveBeenLastCalledWith("k1", expect.any(Number), "default");
  });

  it("rejects what the store refuses", async () => {
    updateCron.mockImplementationOnce(() => {
      throw new Error("No such cron.");
    });
    await expect(cronUpdateVerb({ id: "x", patch: {} })).rejects.toThrow("No such cron.");
  });

  it("changes and deletes a webhook, and says when there's none to delete", async () => {
    expect(await webhookUpdateVerb({ id: "h1", patch: { registered: true } })).toEqual({ hook: { id: "h1", registered: true } });
    expect(await webhookDeleteVerb({ id: "h1" })).toEqual({ ok: true });
    removeWebhook.mockReturnValueOnce(undefined);
    await expect(webhookDeleteVerb({ id: "gone" })).rejects.toThrow(NO_HOOK);
  });
});
