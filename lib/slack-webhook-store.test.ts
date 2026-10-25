import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./web-session", () => ({ serviceClient: vi.fn(() => null) }));

const { FEEDBACK_PURPOSE, readWebhook, saveWebhook } = await import("./slack-webhook-store");
const { serviceClient } = await import("./web-session");

// The webhook's URL is a credential, so it lives in the database (public.slack_webhooks) where only the service
// role can reach it — never in an environment variable that a deploy log could print, never in a page.

// A service client whose every call answers the same result.
const service = (result: { error?: unknown; data?: unknown }) => {
  const maybeSingle = vi.fn(() => Promise.resolve(result));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn(() => Promise.resolve(result));
  const from = vi.fn(() => ({ upsert, select }));
  return { client: { from } as never, from, upsert, select };
};

beforeEach(() => {
  vi.mocked(serviceClient).mockReset();
});

describe("saveWebhook", () => {
  it("writes the url and the channel for the purpose", async () => {
    const upsert = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(serviceClient).mockReturnValue({ from: vi.fn(() => ({ upsert })) } as never);
    expect(await saveWebhook(FEEDBACK_PURPOSE, "https://hooks.slack.com/services/T1/B2/xyz", "#feedback")).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      { purpose: FEEDBACK_PURPOSE, url: "https://hooks.slack.com/services/T1/B2/xyz", channel: "#feedback" },
      { onConflict: "purpose" },
    );
  });

  it("answers false without the service key, and false when the write fails", async () => {
    vi.mocked(serviceClient).mockReturnValue(null);
    expect(await saveWebhook(FEEDBACK_PURPOSE, "https://hooks.slack.com/services/T1/B2/xyz")).toBe(false);

    vi.mocked(serviceClient).mockReturnValue({ from: vi.fn(() => ({ upsert: vi.fn(() => Promise.resolve({ error: "nope" })) })) } as never);
    expect(await saveWebhook(FEEDBACK_PURPOSE, "https://hooks.slack.com/services/T1/B2/xyz")).toBe(false);
  });
});

describe("readWebhook", () => {
  it("reads the url back", async () => {
    vi.mocked(serviceClient).mockReturnValue(service({ data: { url: "https://hooks.slack.com/services/T1/B2/xyz" } }) as never);
    expect(await readWebhook()).toBe("https://hooks.slack.com/services/T1/B2/xyz");
  });

  it("answers null without the service key, on an error, and when there is no row", async () => {
    vi.mocked(serviceClient).mockReturnValue(null);
    expect(await readWebhook()).toBeNull();

    vi.mocked(serviceClient).mockReturnValue(service({ error: "nope" }) as never);
    expect(await readWebhook()).toBeNull();

    vi.mocked(serviceClient).mockReturnValue(service({ data: null }) as never);
    expect(await readWebhook()).toBeNull();
  });
});
