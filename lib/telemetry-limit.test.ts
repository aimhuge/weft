import { beforeEach, describe, expect, it } from "vitest";
import { resetTelemetryLimits, TELEMETRY_PER_MINUTE_PER_IP, telemetryVerdict } from "./telemetry-limit";

const h = (init: Record<string, string>) => new Headers(init);

beforeEach(() => resetTelemetryLimits());

describe("telemetryVerdict", () => {
  it("takes a post with no Origin (the desktop app's Node fetch) or weft.zip's own", () => {
    expect(telemetryVerdict(h({ "x-forwarded-for": "198.51.100.1" }), 0, "p")).toEqual({ ok: true });
    expect(telemetryVerdict(h({ origin: "https://weft.zip", "x-forwarded-for": "198.51.100.1" }), 0, "p")).toEqual({ ok: true });
  });

  it("refuses a browser post from any other origin, without counting it", () => {
    expect(telemetryVerdict(h({ origin: "https://weft.zip.evil.example" }), 0, "p")).toEqual({ ok: false, status: 403 });
    expect(telemetryVerdict(h({ origin: "null" }), 0, "p")).toEqual({ ok: false, status: 403 });
  });

  it("caps each address per minute and lets it back in when the window ends", () => {
    const a = h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    for (let i = 0; i < TELEMETRY_PER_MINUTE_PER_IP; i++) expect(telemetryVerdict(a, 1_000, "p").ok).toBe(true);
    expect(telemetryVerdict(a, 31_000, "p")).toEqual({ ok: false, status: 429, retryAfter: 30 });
    // Another address has its own count.
    expect(telemetryVerdict(h({ "x-forwarded-for": "203.0.113.6" }), 31_000, "p").ok).toBe(true);
    expect(telemetryVerdict(a, 61_000, "p").ok).toBe(true);
  });

  it("reads the pepper from the env by default", () => {
    expect(telemetryVerdict(h({}), 0).ok).toBe(true);
    expect(telemetryVerdict(h({})).ok).toBe(true);
  });
});
