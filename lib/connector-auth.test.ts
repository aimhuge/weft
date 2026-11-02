import { describe, expect, it } from "vitest";
import { checkSignature, FRESH_MS, parseMint, signedWorker } from "./connector-auth";
import { fakeDb, NOW, pairedWorker } from "./connector.harness";
import { MintError } from "./connector-tokens";

const NONCE = "ab".repeat(16);
const BODY = { connector: "github" as const, cardId: "card-1", repo: "o/r", ts: NOW, nonce: NONCE };

async function refusal(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(MintError);
    return { status: (err as MintError).status, message: (err as MintError).message };
  }
  throw new Error("expected a refusal");
}

function expectRefusal(r: { status: number; message: string }, status: number, words: string) {
  expect(r.status).toBe(status);
  expect(r.message).toContain(words);
}

describe("parseMint", () => {
  const ok = { ...BODY, sig: "c2ln" };
  it("takes a well-formed body", () => {
    expect(parseMint(ok)).toEqual(ok);
  });
  it.each([
    [null, "connector"],
    [{ ...ok, connector: "gitlab" }, "connector"],
    [{ ...ok, cardId: 1 }, "card"],
    [{ ...ok, cardId: "a b" }, "card"],
    [{ ...ok, repo: "nope" }, "repo"],
    [{ ...ok, repo: 5 }, "repo"],
    [{ ...ok, ts: "now" }, "when"],
    [{ ...ok, ts: Number.NaN }, "when"],
    [{ ...ok, nonce: "short" }, "nonce"],
    [{ ...ok, nonce: 3 }, "nonce"],
    [{ ...ok, sig: "" }, "Sign"],
    [{ ...ok, sig: 4 }, "Sign"],
    [{ ...ok, sig: "x".repeat(201) }, "Sign"],
  ])("refuses %j with a 400", (raw, word) => {
    expect(() => parseMint(raw)).toThrow(word);
    try {
      parseMint(raw);
    } catch (err) {
      expect((err as MintError).status).toBe(400);
    }
  });
});

describe("checkSignature", () => {
  it("checks the whole request against the paired key", () => {
    const { state } = fakeDb();
    const { worker, signed } = pairedWorker(state);
    const body = signed(BODY);
    expect(checkSignature(worker.sign_key ?? "", { ...BODY, workerId: "w1" }, body.sig)).toBe(true);
    expect(checkSignature(worker.sign_key ?? "", { ...BODY, repo: "o/other", workerId: "w1" }, body.sig)).toBe(false);
    expect(checkSignature("not a key", { ...BODY, workerId: "w1" }, body.sig)).toBe(false);
  });
});

describe("signedWorker", () => {
  it("returns the worker for its key and signature", async () => {
    const { db, state } = fakeDb();
    const { worker, auth, signed } = pairedWorker(state);
    expect(await signedWorker(db, auth, signed(BODY), NOW)).toEqual(worker);
    expect(await signedWorker(db, auth, signed({ ...BODY, ts: NOW - FRESH_MS }), NOW)).toEqual(worker);
  });

  it("refuses no key or a malformed one", async () => {
    const { db, state } = fakeDb();
    const { signed } = pairedWorker(state);
    expectRefusal(await refusal(signedWorker(db, null, signed(BODY), NOW)), 401, "key");
    expect((await refusal(signedWorker(db, "Bearer wwk_short", signed(BODY), NOW))).status).toBe(401);
  });

  it("refuses an unknown or revoked worker", async () => {
    const { db, state } = fakeDb();
    const { signed } = pairedWorker(state, { revoked_at: "2026-11-01T00:00:00Z" });
    expectRefusal(await refusal(signedWorker(db, `Bearer wwk_${"f".repeat(64)}`, signed(BODY), NOW)), 401, "live worker");
    expectRefusal(await refusal(signedWorker(db, `Bearer wwk_a1${"0".repeat(62)}`, signed(BODY), NOW)), 401, "live worker");
  });

  it("refuses a worker enrolled by token (no sign key)", async () => {
    const { db, state } = fakeDb();
    const { auth, signed } = pairedWorker(state, { sign_key: null });
    expectRefusal(await refusal(signedWorker(db, auth, signed(BODY), NOW)), 403, "enrolled by token");
  });

  it("refuses a bad signature, a changed field or one signed for another worker", async () => {
    const { db, state } = fakeDb();
    const { auth, signed } = pairedWorker(state);
    expect((await refusal(signedWorker(db, auth, { ...signed(BODY), sig: "AAAA" }, NOW))).status).toBe(401);
    expect((await refusal(signedWorker(db, auth, { ...signed(BODY), repo: "o/other" }, NOW))).message).toContain("isn't signed");
    expect((await refusal(signedWorker(db, auth, signed(BODY, "w2"), NOW))).message).toContain("isn't signed");
  });

  it("refuses a stale request, either way", async () => {
    const { db, state } = fakeDb();
    const { auth, signed } = pairedWorker(state);
    expectRefusal(await refusal(signedWorker(db, auth, signed({ ...BODY, ts: NOW - FRESH_MS - 1 }), NOW)), 401, "too old");
    expect((await refusal(signedWorker(db, auth, signed({ ...BODY, ts: NOW + FRESH_MS + 1 }), NOW))).message).toContain("too old");
  });
});
