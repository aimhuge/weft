import { beforeEach, describe, expect, it, vi } from "vitest";

// The Mac forwards to the deployed Weft; the deployed Weft captures in PostHog (lib/telemetry-send.ts).

const state = vi.hoisted(() => ({ on: true, config: null as null | { token: string; host: string } }));
vi.mock("./telemetry", async (orig) => ({ ...(await orig<typeof import("./telemetry")>()), telemetryOn: () => state.on, anonymousId: () => "d".repeat(32) }));
vi.mock("./analytics-server", () => ({ serverPosthogConfig: () => state.config }));

const { captureOnboarding, COLLECT_URL, forwardOnboarding } = await import("./telemetry-send");

beforeEach(() => {
  state.on = true;
  state.config = null;
});

describe("forwardOnboarding", () => {
  it("posts an allow-listed event with clean props and the anonymous ID", async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await forwardOnboarding("onboarding_step", { step: "first", prompt: "secret" }, fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(COLLECT_URL, expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body) as unknown;
    expect(sent).toEqual({ event: "onboarding_step", props: { step: "first" }, distinctId: "d".repeat(32) });
  });

  it("sends nothing when the switch is off or the event isn't allow-listed", async () => {
    const fetcher = vi.fn();
    state.on = false;
    expect(await forwardOnboarding("onboarding_step", {}, fetcher)).toBe(false);
    state.on = true;
    expect(await forwardOnboarding("page_view", {}, fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops a stat it can't send", async () => {
    expect(await forwardOnboarding("onboarding_skipped", {}, () => Promise.reject(new Error("offline")))).toBe(false);
  });
});

describe("captureOnboarding", () => {
  const fakePosthog = () => {
    const posthog = { capture: vi.fn(), shutdown: vi.fn(() => Promise.resolve()) };
    return { posthog, make: vi.fn(() => posthog as never) };
  };

  it("refuses an unknown event or a non-anonymous ID", async () => {
    expect(await captureOnboarding({ event: "nope", distinctId: "a".repeat(32) })).toBe(400);
    expect(await captureOnboarding({ event: "onboarding_step", distinctId: "me@example.com" })).toBe(400);
    expect(await captureOnboarding(null)).toBe(400);
  });

  it("accepts and drops it when this Weft has no PostHog keys", async () => {
    const { make } = fakePosthog();
    expect(await captureOnboarding({ event: "onboarding_step", distinctId: "a".repeat(32) }, make)).toBe(204);
    expect(make).not.toHaveBeenCalled();
  });

  it("captures clean props tagged as desktop, with no person profile", async () => {
    state.config = { token: "phc_x", host: "https://eu.i.posthog.com" };
    const { posthog, make } = fakePosthog();
    expect(await captureOnboarding({ event: "onboarding_tour_beat", props: { beat: "pane", seconds: 40, email: "x" }, distinctId: "a".repeat(32) }, make)).toBe(204);
    expect(make).toHaveBeenCalledWith("phc_x", "https://eu.i.posthog.com");
    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: "a".repeat(32),
      event: "onboarding_tour_beat",
      properties: { beat: "pane", seconds: 40, source: "desktop", $process_person_profile: false },
    });
    expect(posthog.shutdown).toHaveBeenCalled();
  });
});
