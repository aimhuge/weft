// The session line's wire (lib/host-line-protocol.ts): each side drops a message it can't read whole.
import { describe, expect, it } from "vitest";
import { deviceOfChannel, iceServers, lineTopic, readControl, readHostCall, readHostReply, readLineEvent, readLineOffer, screenChannel } from "./host-line-protocol";

const j = (v: unknown) => JSON.stringify(v);

describe("the offer", () => {
  it("reads a whole offer with its ICE servers, and nothing short of one", () => {
    const ice = [{ urls: "stun:s" }, { urls: ["turn:t", 7, ""], username: "u", credential: "c" }, { urls: [] }, { urls: 3 }, "x", null];
    expect(readLineOffer(j({ sdp: "v=0", key: "k", topic: "t", ice }))).toEqual({ sdp: "v=0", key: "k", topic: "t", ice: [{ urls: "stun:s" }, { urls: ["turn:t"], username: "u", credential: "c" }] });
    expect(readLineOffer(j({ sdp: "v=0", key: "k", topic: "t" }))).toEqual({ sdp: "v=0", key: "k", topic: "t", ice: [] });
    expect(readLineOffer(j({ sdp: "v=0", key: "k" }))).toBeNull();
    expect(readLineOffer("{nope")).toBeNull();
    expect(readLineOffer(j([1]))).toBeNull();
    expect(iceServers("x")).toEqual([]);
    expect(lineTopic("ab")).toBe("worker-line:ab");
  });
});

describe("host", () => {
  it("reads a call, its args defaulting to none", () => {
    expect(readHostCall(j({ id: 1, verb: "card.stop", args: { id: "c" } }))).toEqual({ id: 1, verb: "card.stop", args: { id: "c" } });
    expect(readHostCall(j({ id: 2, verb: "card.stop", args: [1] }))).toEqual({ id: 2, verb: "card.stop", args: {} });
    expect(readHostCall(j({ id: "1", verb: "x" }))).toBeNull();
    expect(readHostCall(j({ id: 1 }))).toBeNull();
    expect(readHostCall("[]")).toBeNull();
  });

  it("reads a reply that ran or failed, and nothing in between", () => {
    expect(readHostReply(j({ id: 1, ok: true, result: { ok: true, cardId: "c" } }))).toEqual({ id: 1, ok: true, result: { ok: true, cardId: "c" } });
    expect(readHostReply(j({ id: 1, ok: false, error: "no" }))).toEqual({ id: 1, ok: false, error: "no" });
    expect(readHostReply(j({ id: 1, ok: true }))).toBeNull();
    expect(readHostReply(j({ id: 1, ok: false }))).toBeNull();
    expect(readHostReply(j({ ok: true }))).toBeNull();
    expect(readHostReply("x")).toBeNull();
  });
});

describe("events", () => {
  it("reads card and thread changes", () => {
    expect(readLineEvent(j({ t: "card", card: { id: "c" } }))).toEqual({ t: "card", card: { id: "c" } });
    expect(readLineEvent(j({ t: "card", card: {} }))).toBeNull();
    expect(readLineEvent(j({ t: "card_deleted", id: "c" }))).toEqual({ t: "card_deleted", id: "c" });
    expect(readLineEvent(j({ t: "thread_cleared", cardId: "c" }))).toEqual({ t: "thread_cleared", cardId: "c" });
    expect(readLineEvent(j({ t: "thread", cardId: "c", index: 2, item: { kind: "user" } }))).toEqual({ t: "thread", cardId: "c", index: 2, item: { kind: "user" } });
    expect(readLineEvent(j({ t: "thread", cardId: "c", index: 2, item: {}, truncate: true }))).toMatchObject({ truncate: true });
    expect(readLineEvent(j({ t: "thread", cardId: "c", index: "2", item: {} }))).toBeNull();
    expect(readLineEvent(j({ t: "login" }))).toBeNull();
    expect(readLineEvent("")).toBeNull();
  });
});

describe("control", () => {
  it("reads pings, pongs, answers, errors and offers, with or without a screen", () => {
    expect(readControl(j({ t: "ping", at: 5 }))).toEqual({ t: "ping", at: 5 });
    expect(readControl(j({ t: "pong", at: 5 }))).toEqual({ t: "pong", at: 5 });
    expect(readControl(j({ t: "ping" }))).toBeNull();
    expect(readControl(j({ t: "answer", sdp: "a" }))).toEqual({ t: "answer", sdp: "a" });
    expect(readControl(j({ t: "error", message: "m" }))).toEqual({ t: "error", message: "m" });
    expect(readControl(j({ t: "offer", sdp: "o" }))).toEqual({ t: "offer", sdp: "o" });
    expect(readControl(j({ t: "offer", sdp: "o", screen: { device: "d" } }))).toEqual({ t: "offer", sdp: "o", screen: { device: "d" } });
    expect(readControl(j({ t: "offer", sdp: "o", screen: { device: "d", quality: "low", channel: "input:d:1" } }))).toEqual({
      t: "offer",
      sdp: "o",
      screen: { device: "d", quality: "low", channel: "input:d:1" },
    });
    expect(readControl(j({ t: "offer", sdp: "o", screen: { quality: "low" } }))).toEqual({ t: "offer", sdp: "o" });
    expect(readControl(j({ t: "offer" }))).toBeNull();
    expect(readControl("nope")).toBeNull();
  });

  it("names a screen's input channel and reads the device back", () => {
    expect(screenChannel("sim", "0123abcd")).toBe("input:sim:0123abcd");
    expect(deviceOfChannel("input:AB-12:0123abcd")).toBe("AB-12");
    expect(deviceOfChannel("input:sim:n1")).toBeNull();
    expect(deviceOfChannel("input:sim:0123abcd:x")).toBeNull();
    expect(deviceOfChannel("input:s/m:0123abcd")).toBeNull();
    expect(deviceOfChannel("input:")).toBeNull();
    expect(deviceOfChannel("host")).toBeNull();
  });
});
