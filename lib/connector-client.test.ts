// The worker's mint client (lib/connector-client.ts): signs every field, asks weft.zip with its key, and holds a
// card's token per repo until the margin before its expiry.
import { describe, expect, it, vi } from "vitest";
import { connectorClient } from "./connector-client";
import { HOLD_MARGIN_MS, mintMessage } from "./connector-grant";

const EXPIRES = "2026-11-02T12:00:00.000Z";
const T = Date.parse(EXPIRES);

function make(reply: () => Promise<Response> | Response = () => Response.json({ token: "ghu_1", expiresAt: EXPIRES, login: "alex", asks: ["protected_push", 3] })) {
  let now = T - 30 * 60_000;
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(reply()));
  const sign = vi.fn((m: string) => `sig:${m.length}`);
  const client = connectorClient({ site: "https://weft.zip", key: "wwk_k", workerId: "w1", sign, nonce: () => "n1", fetch, now: () => now });
  return { client, fetch, sign, setNow: (n: number) => (now = n) };
}

describe("connectorClient", () => {
  it("signs the mint message and posts it with the worker's key", async () => {
    const { client, fetch, sign } = make();
    const got = await client.get("card-1", "Owner/Repo");
    expect(got).toEqual({ token: "ghu_1", expiresAt: T, login: "alex", asks: ["protected_push"] });
    const ts = T - 30 * 60_000;
    expect(sign).toHaveBeenCalledWith(mintMessage({ workerId: "w1", cardId: "card-1", connector: "github", repo: "Owner/Repo", ts, nonce: "n1" }));
    const url = fetch.mock.calls[0]![0];
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(url).toBe("https://weft.zip/api/connectors/github/mint");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer wwk_k", "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ connector: "github", cardId: "card-1", repo: "Owner/Repo", ts, nonce: "n1", sig: sign.mock.results[0]!.value as string });
  });

  it("holds a token per card and repo until the margin before it expires", async () => {
    const { client, fetch, setNow } = make();
    await client.get("c1", "o/r");
    await client.get("c1", "O/R");
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.get("c2", "o/r");
    expect(fetch).toHaveBeenCalledTimes(2);
    setNow(T - HOLD_MARGIN_MS);
    await client.get("c1", "o/r");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("forgets one card's tokens, and clears them all", async () => {
    const { client, fetch } = make();
    await client.get("c1", "o/r");
    await client.get("c1", "o/s");
    await client.get("c2", "o/r");
    client.forget("c1");
    await client.get("c2", "o/r");
    expect(fetch).toHaveBeenCalledTimes(3);
    await client.get("c1", "o/r");
    expect(fetch).toHaveBeenCalledTimes(4);
    client.clear();
    await client.get("c2", "o/r");
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("defaults login and asks when the answer leaves them out", async () => {
    const { client } = make(() => Response.json({ token: "t", expiresAt: EXPIRES }));
    expect(await client.get("c", "o/r")).toEqual({ token: "t", expiresAt: T, login: "", asks: [] });
  });

  it("says so when weft.zip can't be reached", async () => {
    const { client } = make(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(client.get("c", "o/r")).rejects.toThrow("Couldn't reach weft.zip for a GitHub token.");
  });

  it("passes weft.zip's error on, or names the status", async () => {
    await expect(make(() => Response.json({ error: "Not allowed." }, { status: 403 })).client.get("c", "o/r")).rejects.toThrow("Not allowed.");
    await expect(make(() => new Response("oops", { status: 502 })).client.get("c", "o/r")).rejects.toThrow("weft.zip answered HTTP 502.");
    await expect(make(() => Response.json({ expiresAt: EXPIRES })).client.get("c", "o/r")).rejects.toThrow("weft.zip answered HTTP 200.");
    await expect(make(() => Response.json({ token: "t", expiresAt: 5 })).client.get("c", "o/r")).rejects.toThrow("HTTP 200");
  });
});
