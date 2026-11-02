// The yes behind Local Simulator mode (lib/qa-grants.ts): one card, one worker, one device, for 8 hours, held in memory.
import { beforeEach, describe, expect, it } from "vitest";
import { activeGrant, grantQa, hasQaGrant, QA_GRANT_MS, requireGrant, revokeQa } from "./qa-grants";

const GRANT = { cardId: "card-1", workerId: "worker-1", device: "udid-1", name: "iPhone 17" };
const NOW = 1_700_000_000_000;

beforeEach(() => {
  revokeQa(GRANT.cardId);
  revokeQa("card-2");
});

describe("grantQa", () => {
  it("lasts 8 hours", () => {
    const grant = grantQa(GRANT, NOW);
    expect(grant.until).toBe(NOW + QA_GRANT_MS);
    expect(QA_GRANT_MS).toBe(8 * 60 * 60_000);
  });
});

describe("requireGrant", () => {
  it("refuses a call from another worker", () => {
    grantQa(GRANT, NOW);
    expect(() => requireGrant(GRANT.cardId, "worker-2", NOW)).toThrow("isn't switched on for this thread on this Mac");
  });

  it("refuses a call with no grant at all", () => {
    expect(() => requireGrant(GRANT.cardId, GRANT.workerId, NOW)).toThrow("isn't switched on for this thread on this Mac");
  });

  it("refuses a grant that's up, and forgets it", () => {
    grantQa(GRANT, NOW);
    expect(() => requireGrant(GRANT.cardId, GRANT.workerId, NOW + QA_GRANT_MS)).toThrow("8 hours on this Mac are up");
    expect(hasQaGrant()).toBe(false);
  });

  it("gives the grant back while it's live", () => {
    grantQa(GRANT, NOW);
    expect(requireGrant(GRANT.cardId, GRANT.workerId, NOW + 1_000)).toMatchObject({ device: "udid-1", name: "iPhone 17" });
  });
});

describe("revokeQa", () => {
  it("takes the grant away", () => {
    grantQa(GRANT, NOW);
    expect(hasQaGrant()).toBe(true);
    revokeQa(GRANT.cardId);
    expect(hasQaGrant()).toBe(false);
    expect(() => requireGrant(GRANT.cardId, GRANT.workerId, NOW)).toThrow();
  });
});

describe("hasQaGrant", () => {
  it("says whether any grant is on this Mac", () => {
    expect(hasQaGrant()).toBe(false);
    grantQa(GRANT, NOW);
    expect(hasQaGrant()).toBe(true);
  });
});

describe("activeGrant", () => {
  it("gives the grant back while it's live", () => {
    grantQa(GRANT, NOW);
    expect(activeGrant(GRANT.cardId, NOW)).toMatchObject({ cardId: "card-1", device: "udid-1" });
  });

  it("says nothing about a lapsed one, and doesn't forget it", () => {
    grantQa(GRANT, NOW);
    expect(activeGrant(GRANT.cardId, NOW + QA_GRANT_MS)).toBeUndefined();
    expect(activeGrant(GRANT.cardId, NOW + QA_GRANT_MS - 1)).toMatchObject({ cardId: "card-1" });
  });

  it("says nothing about a card with no grant", () => {
    expect(activeGrant("card-2", NOW)).toBeUndefined();
  });
});
