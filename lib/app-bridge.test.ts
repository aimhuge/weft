import { describe, expect, it } from "vitest";
import { BRIDGE_TAG, parseBridgeRequest } from "./app-bridge";

describe("parseBridgeRequest", () => {
  const base = { tag: BRIDGE_TAG, id: 1 };

  it("accepts a fetch with string headers and body", () => {
    const msg = { ...base, op: "fetch", url: "https://api.stripe.com/v1/charges", method: "GET", headers: { Authorization: "Bearer {{secret:STRIPE_KEY}}" }, body: "x" };
    expect(parseBridgeRequest(msg)).toEqual(msg);
  });

  it("accepts a fetch without a body", () => {
    expect(parseBridgeRequest({ ...base, op: "fetch", url: "https://a.b", method: "GET", headers: {} })).toMatchObject({ op: "fetch", body: undefined });
  });

  it.each([
    ["no url", { ...base, op: "fetch", method: "GET", headers: {} }],
    ["array headers", { ...base, op: "fetch", url: "https://a.b", method: "GET", headers: [] }],
    ["missing headers", { ...base, op: "fetch", url: "https://a.b", method: "GET" }],
    ["a non-string header", { ...base, op: "fetch", url: "https://a.b", method: "GET", headers: { a: 1 } }],
    ["a non-string body", { ...base, op: "fetch", url: "https://a.b", method: "GET", headers: {}, body: {} }],
  ])("refuses a fetch with %s", (_label, msg) => {
    expect(parseBridgeRequest(msg)).toBeNull();
  });

  it("accepts a read and keeps object args only", () => {
    expect(parseBridgeRequest({ ...base, op: "read", name: "signups", args: { days: 7 } })).toEqual({ ...base, op: "read", name: "signups", args: { days: 7 } });
    expect(parseBridgeRequest({ ...base, op: "read", name: "signups", args: [1] })).toEqual({ ...base, op: "read", name: "signups", args: undefined });
  });

  it("refuses a read without a name", () => {
    expect(parseBridgeRequest({ ...base, op: "read" })).toBeNull();
  });

  it("accepts requestSecret with a name and refuses it without", () => {
    expect(parseBridgeRequest({ ...base, op: "requestSecret", name: "OPENAI_API_KEY" })).toEqual({ ...base, op: "requestSecret", name: "OPENAI_API_KEY" });
    expect(parseBridgeRequest({ ...base, op: "requestSecret" })).toBeNull();
  });

  it("accepts env", () => {
    expect(parseBridgeRequest({ ...base, op: "env" })).toEqual({ ...base, op: "env" });
  });

  it("accepts access, the Mac's data-app call", () => {
    expect(parseBridgeRequest({ ...base, op: "access", extra: 1 })).toEqual({ ...base, op: "access" });
  });

  it.each([
    ["null", null],
    ["a string", "hi"],
    ["another tag", { tag: "x", id: 1, op: "env" }],
    ["a string id", { tag: BRIDGE_TAG, id: "1", op: "env" }],
    ["an infinite id", { tag: BRIDGE_TAG, id: Infinity, op: "env" }],
    ["an unknown op", { tag: BRIDGE_TAG, id: 1, op: "eval" }],
    ["a non-string op", { tag: BRIDGE_TAG, id: 1, op: 3 }],
  ])("ignores %s", (_label, msg) => {
    expect(parseBridgeRequest(msg)).toBeNull();
  });
});
