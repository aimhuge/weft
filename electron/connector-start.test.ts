// Main signs a worker card's start for the GitHub connector (electron/connector-start.cjs), only for a repo this Mac
// knows the folder as; checked against lib/connector-messages.ts with the verifier weft.zip's mint uses.
import { describe, expect, it, vi } from "vitest";
import { startMessage } from "../lib/connector-messages";
import { verifyRaw } from "../lib/connector-trust";
import { macKey } from "../lib/connector-trust.harness";
import start from "./connector-start.cjs";

const BODY = { workerId: "w1", cardId: "c-1", folder: "ling", repo: "Ada/Ling" };

function setup(o: { uid?: string | null; repos?: string[] } = {}) {
  const k = macKey();
  const projectRepos = vi.fn(() => Promise.resolve(o.repos ?? ["github:ada/ling"]));
  const sign = start.createStartSigner({ userId: () => (o.uid === undefined ? "u1" : o.uid), sign: (m: string) => Promise.resolve(k.sign(m)), signKey: () => Promise.resolve(k.key), projectRepos, now: () => 7 });
  return { k, sign, projectRepos };
}

describe("createStartSigner", () => {
  it("signs a start in a folder this Mac knows as that repo", async () => {
    const s = setup();
    const r = await s.sign(BODY);
    expect(r).toMatchObject({ key: s.k.key, issuedAt: 7, nonce: expect.stringMatching(/^[0-9a-f]{32}$/) as string });
    expect(verifyRaw(s.k.key, startMessage({ userId: "u1", ...BODY, nonce: r.nonce, issuedAt: 7 }), r.sig)).toBe(true);
    expect((await s.sign(BODY)).nonce).not.toBe(r.nonce);
    expect(s.projectRepos).toHaveBeenCalledWith("ling");
  });

  it("refuses a repo this Mac doesn't know the folder as, or knows two of", async () => {
    await expect(setup({ repos: ["github:ada/other"] }).sign(BODY)).rejects.toThrow("doesn't know ling as Ada/Ling");
    await expect(setup({ repos: [] }).sign(BODY)).rejects.toThrow("doesn't know");
    await expect(setup({ repos: ["github:ada/ling", "github:bob/ling"] }).sign(BODY)).rejects.toThrow("doesn't know");
    expect((await setup({ repos: ["github:ada/ling", "github:ada/ling"] }).sign(BODY)).issuedAt).toBe(7);
  });

  it("refuses when signed out, or a body that isn't a start", async () => {
    await expect(setup({ uid: null }).sign(BODY)).rejects.toThrow("Sign in to Weft first.");
    for (const bad of [null, {}, { ...BODY, cardId: "../x" }, { ...BODY, repo: "nope" }, { ...BODY, folder: "" }, { ...BODY, workerId: 3 }]) {
      await expect(setup().sign(bad)).rejects.toThrow("Name the worker, the card, the folder and the repo.");
    }
  });

  it("signs at the time now by default", async () => {
    const k = macKey();
    const sign = start.createStartSigner({ userId: () => "u1", sign: (m: string) => Promise.resolve(k.sign(m)), signKey: () => Promise.resolve(k.key), projectRepos: () => Promise.resolve(["github:ada/ling"]) });
    expect(Math.abs((await sign(BODY)).issuedAt - Date.now())).toBeLessThan(5_000);
  });
});
