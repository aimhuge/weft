// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_OPENER } from "./feedback";
import { useFeedback } from "./use-feedback";

const fetchMock = vi.fn<typeof fetch>();
// Runs a call and lets its fetch settle.
const run = (fn: () => unknown) =>
  act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
const reply = (status: number, body: unknown) => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const summary = { title: "Cards vanish", body: "- often" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const sentBody = (call: number) => JSON.parse(fetchMock.mock.calls[call]?.[1]?.body as string) as Record<string, unknown>;

describe("useFeedback", () => {
  it("opens with the opener and nothing answered", () => {
    const { result } = renderHook(() => useFeedback());
    expect(result.current.messages).toEqual([{ role: "assistant", text: FEEDBACK_OPENER }]);
    expect(result.current.answered).toBe(false);
  });

  it("asks Haiku after each answer and shows its reply", async () => {
    fetchMock.mockReturnValue(reply(200, { reply: "How often?", summary: null }));
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.say("  Cards vanish "));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/feedback");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-weft-token")).toBe("1");
    expect(sentBody(0)).toEqual({ messages: [{ role: "assistant", text: FEEDBACK_OPENER }, { role: "user", text: "Cards vanish" }], wrap: false });
    expect(result.current.messages.at(-1)).toEqual({ role: "assistant", text: "How often?" });
    expect(result.current.answered).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it("ignores an empty answer", async () => {
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.say("   "));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps up, then sends the summary", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { reply: "q", summary: null })).mockReturnValueOnce(reply(200, { reply: "Here it is", summary })).mockReturnValueOnce(reply(200, { sent: true }));
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.say("x"));
    await run(() => result.current.wrapUp());
    expect(sentBody(1).wrap).toBe(true);
    expect(result.current.summary).toEqual(summary);
    await run(() => result.current.send());
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/feedback/send");
    expect(sentBody(2).summary).toEqual(summary);
    expect(result.current.sent).toBe(true);
  });

  it("does nothing on send without a summary", async () => {
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.send());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's error, or the status when it gave none", async () => {
    fetchMock.mockReturnValueOnce(reply(400, { error: "Say what's in your way first." })).mockReturnValueOnce(reply(500, "oops"));
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.say("x"));
    expect(result.current.error).toBe("Say what's in your way first.");
    await run(() => result.current.say("y"));
    expect(result.current.error).toBe("Request failed (500).");
  });

  it("shows a failed send", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { reply: "ok", summary })).mockReturnValueOnce(reply(400, { error: "bad" }));
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.say("x"));
    await run(() => result.current.send());
    expect(result.current.error).toBe("bad");
    expect(result.current.sent).toBeNull();
  });

  it("ignores answers, wrap-ups and sends while busy", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (finish = r)));
    const { result } = renderHook(() => useFeedback());
    act(() => result.current.say("x"));
    expect(result.current.busy).toBe(true);
    act(() => result.current.say("y"));
    act(() => result.current.wrapUp());
    await run(() => result.current.send());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await run(() => finish(new Response(JSON.stringify({ reply: "r", summary }))));
    act(() => result.current.say("z"));
    expect(result.current.busy).toBe(true);
    await run(() => result.current.send());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("starts over", async () => {
    fetchMock.mockReturnValue(reply(200, { reply: "r", summary }));
    const { result } = renderHook(() => useFeedback());
    await run(() => result.current.say("x"));
    act(() => result.current.reset());
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.summary).toBeNull();
    expect(result.current.sent).toBeNull();
  });
});
