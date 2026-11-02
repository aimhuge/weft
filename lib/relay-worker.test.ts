// A relay on a worker: the webhook's names go to the owner's Mac, which seals and inserts; the worker keeps the URL.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Webhook } from "./webhooks";

const askMac = vi.hoisted(() => vi.fn());
const hooks = vi.hoisted(() => new Map<string, Webhook>());
const githubRepoOf = vi.hoisted(() => vi.fn((): string | undefined => "aimhuge/weft"));

vi.mock("./worker-mac-ask", () => ({ askMac }));
vi.mock("./repos", () => ({ githubRepoOf }));
vi.mock("./webhook-forward", () => ({ NO_PROVIDER: "no provider", NO_SECRET: "no secret" }));
vi.mock("./webhooks", () => ({
  getWebhook: (id: string) => hooks.get(id),
  providerFor: (h: Webhook) => h.provider,
  setRelay: (id: string, relay: { relayId: string; url: string }) => ({ ...hooks.get(id)!, ...relay }),
}));

const { createRelayOnWorker } = await import("./relay-worker");
const hook = (over: Partial<Webhook> = {}) => hooks.set("h1", { id: "h1", folder: "/work/weft", name: "stripe", target: "http://localhost:3000/s", provider: "stripe", secret: "STRIPE_WEBHOOK_SECRET", ...over } as Webhook);

beforeEach(() => {
  hooks.clear();
  askMac.mockReset();
  githubRepoOf.mockReturnValue("aimhuge/weft");
});

describe("createRelayOnWorker", () => {
  it("asks the Mac with names only, and keeps the URL it made", async () => {
    hook();
    askMac.mockResolvedValue({ relayId: "r1", url: "https://weft.zip/api/hooks/r1" });
    expect(await createRelayOnWorker("h1", "c1")).toMatchObject({ relayId: "r1", url: "https://weft.zip/api/hooks/r1" });
    expect(askMac).toHaveBeenCalledWith("c1", "relay_create", { name: "stripe", provider: "stripe", secret: "STRIPE_WEBHOOK_SECRET", repo: "aimhuge/weft", target: "http://localhost:3000/s" });
  });

  it("keeps a relay it has, and refuses what can't have one", async () => {
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("gone");
    hook({ relayId: "r0" });
    expect((await createRelayOnWorker("h1", "c1")).relayId).toBe("r0");
    hook({ provider: undefined });
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("no provider");
    hook({ secret: undefined });
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("no secret");
    hook();
    githubRepoOf.mockReturnValue(undefined);
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("no GitHub origin");
    expect(askMac).not.toHaveBeenCalled();
  });

  it("says what the Mac said: no Touch ID, no value, or nothing made", async () => {
    hook();
    askMac.mockResolvedValueOnce({ denied: true });
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("Touch ID");
    askMac.mockResolvedValueOnce({ missing: true });
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("STRIPE_WEBHOOK_SECRET has no value");
    askMac.mockResolvedValueOnce({});
    await expect(createRelayOnWorker("h1", "c1")).rejects.toThrow("didn't make the relay");
  });
});
