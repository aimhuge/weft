import { beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.fn<(fn: () => unknown) => void>();
const mirrorShas = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const serviceClient = vi.fn<() => unknown>();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => after(fn) }));
vi.mock("./r2-mirror", () => ({ mirrorShas: (...args: unknown[]) => mirrorShas(...args) }));
vi.mock("./web-session", () => ({ serviceClient: () => serviceClient() }));

const { queueMirror } = await import("./r2-queue");
const ORG = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("R2_ACCOUNT_ID", "acc");
  vi.stubEnv("R2_ACCESS_KEY_ID", "id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  serviceClient.mockReturnValue({ service: true });
});

describe("queueMirror", () => {
  it("copies the shas after the response", async () => {
    queueMirror(ORG)([SHA]);
    expect(after).toHaveBeenCalledTimes(1);
    await (after.mock.calls[0]?.[0] as () => Promise<void>)();
    expect(mirrorShas).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ accountId: "acc" }), ORG, [SHA]);
  });

  it("takes a single sha too", () => {
    queueMirror(ORG)(SHA);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the service key, R2's settings, or any shas", () => {
    queueMirror(ORG)([]);
    serviceClient.mockReturnValue(null);
    queueMirror(ORG)([SHA]);
    serviceClient.mockReturnValue({ service: true });
    vi.stubEnv("WEFT_BLOBS_R2", "off");
    queueMirror(ORG)([SHA]);
    expect(after).not.toHaveBeenCalled();
  });

  it("is quiet outside a request", () => {
    after.mockImplementationOnce(() => {
      throw new Error("after() outside a request scope");
    });
    expect(() => queueMirror(ORG)([SHA])).not.toThrow();
  });
});
