import { describe, expect, it, vi } from "vitest";
import { createSlackWho } from "./slack-who.cjs";
import { SlackError } from "./slack-api.cjs";

describe("createSlackWho", () => {
  it("asks Slack once and keeps the answer", async () => {
    const ask = vi.fn(() => Promise.resolve({ team: "Acme", url: "https://acme.slack.com/", user: "weft" }));
    const who = createSlackWho(ask);
    expect(await who.load()).toEqual({ team: "Acme", teamUrl: "https://acme.slack.com/", bot: "weft" });
    expect(await who.load()).toEqual({ team: "Acme", teamUrl: "https://acme.slack.com/", bot: "weft" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("keeps only what Slack says in words", async () => {
    const who = createSlackWho(() => Promise.resolve({ team: 7, url: true, user: null }));
    expect(await who.load()).toEqual({ team: null, teamUrl: null, bot: null });
  });

  it("forgets the answer when the token is dead", async () => {
    const who = createSlackWho(() => Promise.resolve({ team: "Acme" }));
    await who.load();
    expect(who.get()?.team).toBe("Acme");
    who.forgetIfTokenIsDead(new SlackError("invalid_auth", "turned down"));
    expect(who.get()).toBeNull();
  });

  it("keeps the answer when the failure is something else", async () => {
    const who = createSlackWho(() => Promise.resolve({ team: "Acme" }));
    await who.load();
    who.forgetIfTokenIsDead(new SlackError("ratelimited", "slow down"));
    who.forgetIfTokenIsDead(new Error("network down"));
    expect(who.get()?.team).toBe("Acme");
  });

  it("is emptied on purpose", async () => {
    const who = createSlackWho(() => Promise.resolve({ team: "Acme" }));
    await who.load();
    who.clear();
    expect(who.get()).toBeNull();
  });

  it("reports a failed ask, and asks again next time", async () => {
    let calls = 0;
    const who = createSlackWho(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new SlackError("invalid_auth", "turned down")) : Promise.resolve({ team: "Acme" });
    });
    await expect(who.load()).rejects.toThrow("turned down");
    expect(who.get()).toBeNull();
    expect(await who.load()).toMatchObject({ team: "Acme" });
    expect(calls).toBe(2);
  });
});
