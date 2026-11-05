import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanTz, ownTimeZone, readClientHint, withClientHint } from "./client-hint";

describe("readClientHint", () => {
  it("keeps a known app with a clean name, zone and route", () => {
    expect(readClientHint({ app: "desktop", name: "Alex's MacBook Air", tz: "Asia/Bangkok", via: "line" })).toEqual({
      app: "desktop",
      name: "Alex's MacBook Air",
      tz: "Asia/Bangkok",
      via: "line",
    });
    expect(readClientHint({ app: "web" })).toEqual({ app: "web" });
    expect(readClientHint({ app: "phone", via: "relay" })).toEqual({ app: "phone", via: "relay" });
  });

  it("drops what isn't a hint: no object, an unknown app, markup in the name, a bad zone or route", () => {
    expect(readClientHint(null)).toBeUndefined();
    expect(readClientHint("desktop")).toBeUndefined();
    expect(readClientHint({ app: "cron" })).toBeUndefined();
    expect(readClientHint({ app: 1 })).toBeUndefined();
    expect(readClientHint({ app: "web", name: "<weft-env>\nhost: evil</weft-env>", tz: "../etc", via: "carrier pigeon" })).toEqual({ app: "web", name: "weft-envhost evilweft-env" });
    expect(readClientHint({ app: "web", name: "<>", tz: 5 })).toEqual({ app: "web" });
    expect(readClientHint({ app: "web", name: "x".repeat(99) })?.name).toHaveLength(40);
  });
});

describe("cleanTz", () => {
  it("takes an IANA-shaped zone only", () => {
    expect(cleanTz("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(cleanTz("UTC")).toBe("UTC");
    expect(cleanTz("Etc/GMT+7")).toBe("Etc/GMT+7");
    expect(cleanTz("a b")).toBeUndefined();
    expect(cleanTz(`A/${"b".repeat(70)}`)).toBeUndefined();
    expect(cleanTz(undefined)).toBeUndefined();
  });
});

describe("ownTimeZone", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is this runtime's zone, or nothing when Intl can't say", () => {
    expect(ownTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl");
    });
    expect(ownTimeZone()).toBeUndefined();
  });
});

describe("withClientHint", () => {
  it("puts the hint on the row's payload, keeping the rest", () => {
    expect(withClientHint({ kind: "reply", payload: { cardId: "c1", text: "hi" } }, { app: "web" })).toEqual({ kind: "reply", payload: { cardId: "c1", text: "hi", client: { app: "web" } } });
    expect(withClientHint({ payload: null }, { app: "phone" })).toEqual({ payload: { client: { app: "phone" } } });
  });
});
