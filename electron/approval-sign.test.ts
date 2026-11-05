// What main signs for the desktop board and how it words Touch ID (electron/approval-sign.cjs).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSignRequest, serverCards, signPrompt, waitingRequest } from "./approval-sign.cjs";

afterEach(() => vi.unstubAllGlobals());

describe("readSignRequest", () => {
  const ok = { orgId: "o", cardId: "c", pendingId: "p", allow: true };
  it("takes a well-formed request and drops any text the board adds", () => {
    expect(readSignRequest({ ...ok, label: "Bash: ls", host: "worker:w" })).toEqual(ok);
    expect(readSignRequest({ ...ok, answers: { q: "a" }, grant: "card" })).toEqual({ ...ok, answers: { q: "a" }, grant: "card" });
  });
  it.each([
    [null, /Nothing/],
    [{ ...ok, orgId: "" }, /missing/],
    [{ ...ok, cardId: "c\nx" }, /missing/],
    [{ ...ok, allow: "yes" }, /missing/],
    [{ ...ok, pendingId: "p".repeat(201) }, /missing/],
    [{ ...ok, grant: "forever" }, /grant/],
    [{ ...ok, answers: { q: 1 } }, /answers/],
    [{ ...ok, answers: "a" }, /answers/],
  ])("refuses %j", (raw, why) => {
    expect(readSignRequest(raw)).toMatch(why);
  });
});

describe("signPrompt", () => {
  const card = { id: "c", title: "Ship it" };
  it.each([
    [{ command: "ls -la" }, undefined, 'allow Bash: ls -la, on "Ship it"'],
    [{ file_path: "/a/b.ts", content: "x" }, "card", "allow Bash: /a/b.ts and for this card's folder, on \"Ship it\""],
    [{ a: 1 }, undefined, 'allow Bash: {"a":1}, on "Ship it"'],
    [null, undefined, 'allow Bash: {}, on "Ship it"'],
    [{ command: "echo hi\u202e\n\tthere" }, undefined, 'allow Bash: echo hi there, on "Ship it"'],
  ])("says %j", (input, grant, want) => {
    expect(signPrompt(card, { toolName: "Bash", input }, true, grant)).toBe(want);
  });
  it("cuts a long command and names an untitled card", () => {
    const prompt = signPrompt({ id: "c" }, { toolName: "Bash", input: { command: "x".repeat(300) } }, false);
    expect(prompt).toMatch(/^deny Bash: x{119}…, on "Untitled"$/);
  });
});

describe("waitingRequest", () => {
  it("finds the card and its waiting request", async () => {
    const pending = { id: "p", toolName: "Bash", input: {} };
    const cards = () => Promise.resolve([{ id: "c", title: "T", pending }]);
    expect(await waitingRequest(cards, { cardId: "c", pendingId: "p" })).toEqual({ card: { id: "c", title: "T", pending }, pending });
  });
});

describe("serverCards", () => {
  type Res = { ok?: boolean; json: () => Promise<{ cards?: { id: string }[]; card?: unknown }> };
  const respond = (url: string): Promise<Res> =>
    Promise.resolve(url.endsWith("/api/copilot") ? { ok: true, json: () => Promise.resolve({ card: { id: "copilot" } }) } : { ok: true, json: () => Promise.resolve({ cards: [{ id: "c" }] }) });

  it("reads the cards and the copilot from main's own server with the read token", async () => {
    const fetch = vi.fn(respond);
    vi.stubGlobal("fetch", fetch);
    expect(await serverCards(() => ({ url: "http://127.0.0.1:1" }))()).toEqual([{ id: "c" }, { id: "copilot" }]);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1/api/cards", { headers: { "x-weft-token": "1" } });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1/api/copilot", { headers: { "x-weft-token": "1" } });
    await expect(serverCards(() => undefined)()).rejects.toThrow(/isn't up/);
  });

  it("leaves out a copilot that won't read, and a list that isn't one", async () => {
    const fetch = vi.fn((url: string): Promise<Res> => (url.endsWith("/api/copilot") ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    vi.stubGlobal("fetch", fetch);
    expect(await serverCards(() => ({ url: "http://127.0.0.1:1" }))()).toEqual([]);
    fetch.mockImplementation((url: string) => (url.endsWith("/api/copilot") ? Promise.reject(new Error("down")) : respond(url)));
    expect(await serverCards(() => ({ url: "http://127.0.0.1:1" }))()).toEqual([{ id: "c" }]);
    fetch.mockImplementation((url: string) => (url.endsWith("/api/copilot") ? Promise.resolve({ ok: true, json: () => Promise.resolve({ card: "x" }) }) : respond(url)));
    expect(await serverCards(() => ({ url: "http://127.0.0.1:1" }))()).toEqual([{ id: "c" }]);
  });
});
