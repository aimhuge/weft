import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PAGE_PER_MINUTE_PER_IP, PAGE_PER_MINUTE_PER_SHARE, pageLimitKeys, pageLimitVerdict, resetPageLimits } from "./app-page-limit";

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });

beforeEach(() => resetPageLimits());

describe("pageLimitVerdict", () => {
  it("lets a real crowd through", () => {
    for (let i = 0; i < PAGE_PER_MINUTE_PER_IP; i++) expect(pageLimitVerdict("s1", from("1.1.1.1"), 1000, "k").ok).toBe(true);
  });

  it("caps one address past its per-minute count, with the seconds left in the window", () => {
    for (let i = 0; i < PAGE_PER_MINUTE_PER_IP; i++) pageLimitVerdict("s1", from("1.1.1.1"), 0, "k");
    expect(pageLimitVerdict("s1", from("1.1.1.1"), 20_000, "k")).toEqual({ ok: false, bucket: "ip", retryAfter: 40 });
    // another address still gets in
    expect(pageLimitVerdict("s1", from("2.2.2.2"), 20_000, "k").ok).toBe(true);
  });

  it("counts an address across shares", () => {
    for (let i = 0; i < PAGE_PER_MINUTE_PER_IP; i++) pageLimitVerdict(`s${i % 7}`, from("1.1.1.1"), 0, "k");
    expect(pageLimitVerdict("other", from("1.1.1.1"), 0, "k").ok).toBe(false);
  });

  it("opens again once the window ends", () => {
    for (let i = 0; i <= PAGE_PER_MINUTE_PER_IP; i++) pageLimitVerdict("s1", from("1.1.1.1"), 0, "k");
    expect(pageLimitVerdict("s1", from("1.1.1.1"), 59_999, "k").ok).toBe(false);
    expect(pageLimitVerdict("s1", from("1.1.1.1"), 60_000, "k").ok).toBe(true);
  });

  it("caps one share across many addresses", () => {
    for (let i = 0; i < PAGE_PER_MINUTE_PER_SHARE; i++) pageLimitVerdict("s1", from(`10.0.${i >> 8}.${i & 255}`), 0, "k");
    expect(pageLimitVerdict("s1", from("9.9.9.9"), 59_500, "k")).toEqual({ ok: false, bucket: "share", retryAfter: 1 });
    expect(pageLimitVerdict("s2", from("9.9.9.9"), 59_500, "k").ok).toBe(true);
  });

  it("keeps no raw address and reads the pepper from the env by default", () => {
    vi.stubEnv("WEFT_MINIAPP_KEY", "pepper");
    pageLimitVerdict("s1", from("1.1.1.1"));
    vi.stubEnv("WEFT_MINIAPP_KEY", undefined);
    pageLimitVerdict("s1", from("1.1.1.1"));
    vi.unstubAllEnvs();
    expect(pageLimitKeys()).toBe(3);
  });

  it("sweeps ended windows once the map is large", () => {
    for (let i = 0; i < 10_000; i++) pageLimitVerdict(`s${i}`, from(`10.1.${i >> 8}.${i & 255}`), 0, "k");
    expect(pageLimitKeys()).toBe(20_000);
    pageLimitVerdict("mid", from("4.4.4.4"), 30_000, "k");
    expect(pageLimitKeys()).toBe(20_002);
    pageLimitVerdict("late", from("3.3.3.3"), 61_000, "k");
    expect(pageLimitKeys()).toBe(4);
  });
});
