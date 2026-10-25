import { beforeEach, describe, expect, it, vi } from "vitest";

// The feedback dot's routes: the interview turn (/api/feedback), the send (/api/feedback/send) and the deployed
// collector (/api/feedback/collect), with Haiku, the account, the store and the relay mocked.

const complete = vi.fn();
vi.mock("@/lib/haiku", () => ({ complete }));
const accountView = vi.fn();
vi.mock("@/lib/account", () => ({ accountView }));
const saveFeedback = vi.fn();
vi.mock("@/lib/feedback-store", () => ({ saveFeedback }));
const forwardFeedback = vi.fn();
const collectFeedback = vi.fn();
vi.mock("@/lib/feedback-send", () => ({ forwardFeedback, collectFeedback }));

const { WRAP_REPLY } = await import("@/lib/feedback");
const turn = await import("./feedback/route");
const send = await import("./feedback/send/route");
const collect = await import("./feedback/collect/route");

const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown, headers: Record<string, string> = { "x-weft-token": "1" }) =>
  route.POST(new Request("http://localhost:3457/api/feedback", { method: "POST", headers: { host: "localhost:3457", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const messages = [{ role: "user", text: "Cards vanish" }];
const summary = { title: "Cards vanish", body: "- after restart" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/feedback", () => {
  it("answers Haiku's next turn", async () => {
    complete.mockResolvedValue('{"reply":"How often?","summary":null}');
    const res = await post(turn, { messages });
    expect(await res.json()).toEqual({ reply: "How often?", summary: null });
    expect(complete.mock.calls[0]?.[0]).toContain("User: Cards vanish");
  });

  it("asks for the summary alone when wrapping up", async () => {
    complete.mockResolvedValue('{"title":"Cards vanish","body":"- after restart"}');
    const res = await post(turn, { messages, wrap: true });
    expect(await res.json()).toEqual({ reply: WRAP_REPLY, summary });
    expect(complete.mock.calls[0]?.[0]).toContain("Summarize");
  });

  it("refuses a body that isn't JSON", async () => {
    const res = await turn.POST(new Request("http://localhost:3457/api/feedback", { method: "POST", headers: { host: "localhost:3457", "x-weft-token": "1" }, body: "nope" }));
    expect(res.status).toBe(400);
    const sent = await send.POST(new Request("http://localhost:3457/api/feedback/send", { method: "POST", headers: { host: "localhost:3457", "x-weft-token": "1" }, body: "nope" }));
    expect(sent.status).toBe(400);
  });

  it("refuses an empty transcript", async () => {
    expect((await post(turn, { messages: [] })).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("POST /api/feedback/send", () => {
  it("forwards with the signed-in account and keeps a copy", async () => {
    accountView.mockResolvedValue({ configured: true, user: { name: "Ada", email: "ada@b.co" } });
    forwardFeedback.mockResolvedValue(true);
    expect(await (await post(send, { messages, summary })).json()).toEqual({ sent: true });
    expect(forwardFeedback).toHaveBeenCalledWith(expect.objectContaining({ summary, from: { name: "Ada", email: "ada@b.co" } }));
    expect(saveFeedback).toHaveBeenCalledWith(expect.objectContaining({ summary, sent: true }));
  });

  it("sends signed out when the account can't be read, and keeps an unsent copy", async () => {
    accountView.mockRejectedValue(new Error("no"));
    forwardFeedback.mockResolvedValue(false);
    expect(await (await post(send, { messages, summary })).json()).toEqual({ sent: false });
    expect(saveFeedback).toHaveBeenCalledWith(expect.objectContaining({ from: null, sent: false }));
  });

  it("refuses a missing summary", async () => {
    expect((await post(send, { messages })).status).toBe(400);
  });
});

describe("POST /api/feedback/collect", () => {
  it("answers the collector's status, keyed by the caller's address", async () => {
    collectFeedback.mockResolvedValue(204);
    const res = await post(collect, { summary }, { "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(res.status).toBe(204);
    expect(collectFeedback).toHaveBeenCalledWith({ summary }, "1.2.3.4");
  });

  it("uses one key when there's no address", async () => {
    collectFeedback.mockResolvedValue(400);
    expect((await post(collect, null, {})).status).toBe(400);
    expect(collectFeedback).toHaveBeenCalledWith(null, "unknown");
  });
});
