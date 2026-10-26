import { describe, expect, it } from "vitest";

import { challengeOf, makeState, makeVerifier, readState, stateSecret } from "./slack-pkce";

// PKCE for the Slack install (lib/slack-pkce.ts): the app is a public client, so the code exchange proves
// itself with a verifier instead of the Client Secret.
//
// The verifier travels in the `state`, signed — one round trip, no store, and a tampered state can't make
// the callback send someone else's verifier.

const secret = "a-signing-key";

describe("makeVerifier", () => {
  it("makes a verifier Slack accepts (43-128 unreserved characters)", () => {
    const verifier = makeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("makes a different one every time", () => {
    expect(makeVerifier()).not.toBe(makeVerifier());
  });
});

describe("challengeOf", () => {
  it("is the base64url SHA-256 of the verifier, which is what S256 means", () => {
    // The RFC 7636 test vector.
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("has no characters URL encoding would change", () => {
    expect(challengeOf(makeVerifier())).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe("makeState and readState", () => {
  it("carries the verifier back, and says it is ours", () => {
    const made = makeState(secret);
    expect(made.ok).toBe(true);
    const read = readState(made.value, secret);
    expect(read.ok).toBe(true);
    expect(read.verifier).toBe(made.verifier);
    expect(read.challenge).toBe(made.challenge);
  });

  it("makes a different verifier every time", () => {
    expect(makeState(secret).verifier).not.toBe(makeState(secret).verifier);
  });

  it("refuses a state signed with another key", () => {
    const made = makeState(secret);
    const read = readState(made.value, "another-key");
    expect(read.ok).toBe(false);
    expect(read.verifier).toBe("");
  });

  it("refuses a state whose verifier was swapped in", () => {
    const made = makeState(secret);
    const parts = made.value.split(".");
    const tampered = [parts[0], makeVerifier(), parts[2], parts[3]].join(".");
    expect(readState(tampered, secret).ok).toBe(false);
  });

  it("refuses a state older than its window", () => {
    const now = 1_700_000_000_000;
    const made = makeState(secret, now);
    expect(readState(made.value, secret, now + 60_000).ok).toBe(true);
    expect(readState(made.value, secret, now + 16 * 60_000).ok).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(readState(null, secret).ok).toBe(false);
    expect(readState("", secret).ok).toBe(false);
    expect(readState("not-a-state", secret).ok).toBe(false);
  });

  it("refuses a state whose signature is the wrong length", () => {
    // A signature of another length is refused before the comparison, so nothing leaks about the bytes.
    const made = makeState(secret);
    const parts = made.value.split(".");
    const short = [parts[0], parts[1], parts[2], "abc"].join(".");
    expect(readState(short, secret).ok).toBe(false);
    expect(readState(short, secret).verifier).toBe("");
  });

  it("refuses a state with no signature at all", () => {
    const made = makeState(secret);
    const parts = made.value.split(".");
    const empty = [parts[0], parts[1], parts[2], ""].join(".");
    expect(readState(empty, secret).ok).toBe(false);
    expect(readState(empty, secret).verifier).toBe("");
  });

  it("refuses a state from the future", () => {
    const now = 1_700_000_000_000;
    const made = makeState(secret, now);
    // A timestamp ahead of the clock is not a fresh state; it is a tampered one.
    expect(readState(made.value, secret, now - 60_000).ok).toBe(false);
  });

  it("refuses a state whose timestamp is not a number", () => {
    const made = makeState(secret);
    const parts = made.value.split(".");
    const broken = [parts[0], parts[1], "not-a-time", parts[3]].join(".");
    // The signature no longer matches the payload, so it is refused before the age is read.
    expect(readState(broken, secret).ok).toBe(false);
  });
});

describe("stateSecret", () => {
  it("prefers the app's client secret, then the server's own secret", () => {
    expect(stateSecret({ SLACK_CLIENT_SECRET: "client" })).toBe("client");
    expect(stateSecret({ SLACK_STATE_SECRET: "state" })).toBe("state");
    expect(stateSecret({})).toBe("weft-slack-pkce");
  });
});
