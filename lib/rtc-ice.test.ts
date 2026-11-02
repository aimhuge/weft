// The session line's ICE servers (lib/rtc-ice.ts): STUN alone without a TURN key, minted TURN credentials with one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetIce, iceFromCloudflare, mintIce, STUN_ONLY, TURN_TTL_S } from "./rtc-ice";

const env = { CLOUDFLARE_TURN_KEY_ID: "kid", CLOUDFLARE_TURN_KEY_API_TOKEN: "tok" };
const turn = { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"], username: "u", credential: "c" };
const answer = (body: unknown, ok = true) => vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 401, json: () => Promise.resolve(body) }));

beforeEach(forgetIce);

describe("iceFromCloudflare", () => {
  it("reads the list or the older single object, dropping port 53 and servers left with no address", () => {
    expect(iceFromCloudflare({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }, turn] })).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
    ]);
    expect(iceFromCloudflare({ iceServers: { urls: "turns:turn.cloudflare.com:443?transport=tcp", username: "u", credential: "c" } })).toEqual([
      { urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" },
    ]);
    expect(iceFromCloudflare({ iceServers: [{ urls: "stun:x:53" }] })).toEqual([]);
    expect(iceFromCloudflare(null)).toEqual([]);
  });
});

describe("mintIce", () => {
  it("is STUN alone without a key", async () => {
    const fetcher = answer({});
    await expect(mintIce({}, fetcher)).resolves.toEqual({ iceServers: STUN_ONLY, turn: false });
    await expect(mintIce({ CLOUDFLARE_TURN_KEY_ID: "kid" }, fetcher)).resolves.toMatchObject({ turn: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mints short-lived credentials with the key, and reuses them for half their life", async () => {
    const fetcher = answer({ iceServers: [turn] });
    const got = await mintIce(env, fetcher, 0);
    expect(got).toEqual({ iceServers: [{ ...turn, urls: [turn.urls[0]] }], turn: true });
    expect(fetcher).toHaveBeenCalledWith("https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ ttl: TURN_TTL_S }),
    });
    await mintIce(env, fetcher, 1_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await mintIce(env, fetcher, (TURN_TTL_S * 1000) / 2 + 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to STUN when Cloudflare refuses, fails or sends no TURN server", async () => {
    await expect(mintIce(env, answer({}, false))).resolves.toEqual({ iceServers: STUN_ONLY, turn: false });
    await expect(mintIce(env, answer({ iceServers: [{ urls: "stun:s" }] }))).resolves.toMatchObject({ turn: false });
    await expect(mintIce(env, () => Promise.reject(new Error("offline")))).resolves.toMatchObject({ turn: false });
  });

  it("reads the key from the environment by default", async () => {
    await expect(mintIce()).resolves.toMatchObject({ iceServers: STUN_ONLY });
  });
});
