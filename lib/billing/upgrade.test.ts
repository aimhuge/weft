import { describe, expect, it } from "vitest";
import { isPukuCapError, TEAM_GATE_MESSAGE, UPGRADE_COPY, upgradeReasonOf } from "./upgrade";

describe("upgradeReasonOf", () => {
  it("reads the refusal's upgrade field", () => {
    expect(upgradeReasonOf({ ok: false, message: "x", upgrade: "share-room" })).toBe("share-room");
  });

  it("knows the team gate's words from a weft.zip without the field", () => {
    expect(upgradeReasonOf({ ok: false, message: TEAM_GATE_MESSAGE })).toBe("teams");
  });

  it("is null for a success or any other refusal", () => {
    expect(upgradeReasonOf({ ok: true, upgrade: "teams" })).toBeNull();
    expect(upgradeReasonOf({ ok: false, message: "Not allowed." })).toBeNull();
  });
});

describe("isPukuCapError", () => {
  it("spots the proxy's free-cap refusal", () => {
    expect(isPukuCapError("429: You've used today's free Puku trial in Weft. Log in to Puku…")).toBe(true);
  });

  it("is false for other errors and none", () => {
    expect(isPukuCapError("This month's Weft Pro Puku allowance is used up.")).toBe(false);
    expect(isPukuCapError(null)).toBe(false);
    expect(isPukuCapError(undefined)).toBe(false);
  });
});

describe("UPGRADE_COPY", () => {
  it("has words for every reason, the share room read from the catalog", () => {
    expect(Object.keys(UPGRADE_COPY).sort()).toEqual(["plan", "puku-cap", "share-room", "teams"]);
    expect(UPGRADE_COPY["share-room"].sub).toContain("1 GB");
    expect(UPGRADE_COPY["share-room"].sub).toContain("5 GB");
  });
});
