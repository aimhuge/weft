// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- asserting on vi.fn() mocks */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({ __loaded: false, init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: posthog }));

import { analyticsOn, startAnalytics, track, trackClick } from "./analytics";

beforeEach(() => {
  posthog.__loaded = false;
  posthog.init.mockReset();
  posthog.capture.mockReset();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_x");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.gtag;
});

describe("startAnalytics", () => {
  it("does nothing on a local board, even with the keys set", () => {
    const doc = { addEventListener: vi.fn() } as unknown as Document;
    expect(startAnalytics("localhost", doc)).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(doc.addEventListener).not.toHaveBeenCalled();
  });

  it("starts PostHog and the click listener on weft.zip", () => {
    const doc = { addEventListener: vi.fn() } as unknown as Document;
    expect(startAnalytics("weft.zip", doc)).toBe(true);
    expect(posthog.init).toHaveBeenCalledWith("phc_x", expect.objectContaining({ api_host: "https://us.i.posthog.com" }));
    expect(doc.addEventListener).toHaveBeenCalledWith("click", trackClick, { capture: true });
  });

  it("keeps the click listener for GA when PostHog has no keys", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
    const doc = { addEventListener: vi.fn() } as unknown as Document;
    expect(startAnalytics("weft.zip", doc)).toBe(false);
    expect(doc.addEventListener).toHaveBeenCalled();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("reads the page's own host by default", () => {
    expect(startAnalytics()).toBe(false);
  });
});

describe("track", () => {
  it("is silent when neither tool is on the page", () => {
    track("thread_started");
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(analyticsOn()).toBe(false);
  });

  it("sends one event to PostHog and GA under the same name", () => {
    posthog.__loaded = true;
    window.gtag = vi.fn();
    track("thread_started", { model: "default" });
    expect(posthog.capture).toHaveBeenCalledWith("thread_started", { model: "default" });
    expect(window.gtag).toHaveBeenCalledWith("event", "thread_started", { model: "default" });
  });
});

describe("trackClick", () => {
  it("tracks a data-track link with its data-track-* props and href", () => {
    window.gtag = vi.fn();
    document.body.innerHTML = `<a href="https://example.com/Weft.dmg" data-track="download_clicked" data-track-version="0.4.0" data-other="x"><span>Download</span></a>`;
    trackClick({ target: document.querySelector("span") } as unknown as Event);
    expect(window.gtag).toHaveBeenCalledWith("event", "download_clicked", { version: "0.4.0", href: "https://example.com/Weft.dmg" });
  });

  it("tracks a non-link element without an href", () => {
    window.gtag = vi.fn();
    document.body.innerHTML = `<button data-track="faq_opened" data-track-question-id="q1">Open</button>`;
    trackClick({ target: document.querySelector("button") } as unknown as Event);
    expect(window.gtag).toHaveBeenCalledWith("event", "faq_opened", { questionId: "q1" });
  });

  it("ignores clicks outside a data-track element and non-element targets", () => {
    window.gtag = vi.fn();
    document.body.innerHTML = `<p>plain</p><a data-track="">empty</a>`;
    trackClick({ target: document.querySelector("p") } as unknown as Event);
    trackClick({ target: document.querySelector("a") } as unknown as Event);
    trackClick({ target: null } as unknown as Event);
    expect(window.gtag).not.toHaveBeenCalled();
  });
});
