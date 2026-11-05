import { describe, expect, it } from "vitest";
import {
  deviceView,
  formatFingerprint,
  isValidFingerprint,
  lastSeenLabel,
  normalizeFingerprint,
  pendingGrantView,
  platformLabel,
  sortDevices,
  sortPendingGrants,
  type DeviceRow,
  type PendingGrantRow,
} from "./team-devices-view";

// The fingerprint is the TOFU comparison, so the formatter is pinned hard: 16 bytes of hex, 8 groups of 4.
const HEX = "a1b2c3d4e5f67890abcdef0123456789";
const GROUPS = "a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789";

describe("formatFingerprint", () => {
  it("groups 32 hex characters into 8 groups of 4", () => {
    expect(formatFingerprint(HEX)).toBe(GROUPS);
  });

  it("normalizes the shapes a fingerprint can be pasted in", () => {
    expect(formatFingerprint(GROUPS)).toBe(GROUPS);
    expect(formatFingerprint(GROUPS.replace(/ /g, "-"))).toBe(GROUPS);
    expect(formatFingerprint(HEX.toUpperCase())).toBe(GROUPS);
    expect(formatFingerprint(`  ${HEX}  `)).toBe(GROUPS);
  });

  it("returns the raw string when it isn't a fingerprint at all", () => {
    expect(formatFingerprint("not-a-fingerprint")).toBe("not-a-fingerprint");
    expect(formatFingerprint("recovery")).toBe("recovery");
    expect(formatFingerprint(null)).toBe("");
    expect(formatFingerprint(undefined)).toBe("");
  });
});

describe("normalizeFingerprint", () => {
  it("lowercases and strips the separators", () => {
    expect(normalizeFingerprint(GROUPS)).toBe(HEX);
    expect(normalizeFingerprint(HEX.toUpperCase())).toBe(HEX);
  });

  it("is null for the wrong length, and for a non-string", () => {
    expect(normalizeFingerprint("a1b2")).toBeNull();
    expect(normalizeFingerprint(`${HEX}00`)).toBeNull();
    expect(normalizeFingerprint("")).toBeNull();
    expect(normalizeFingerprint(null)).toBeNull();
    expect(normalizeFingerprint(undefined)).toBeNull();
    expect(normalizeFingerprint(123 as unknown as string)).toBeNull();
  });
});

describe("isValidFingerprint", () => {
  it("accepts a 16-byte fingerprint in any of the paste shapes", () => {
    expect(isValidFingerprint(HEX)).toBe(true);
    expect(isValidFingerprint(GROUPS)).toBe(true);
    expect(isValidFingerprint(GROUPS.replace(/ /g, ":"))).toBe(true);
  });

  it("rejects anything that isn't one", () => {
    expect(isValidFingerprint("a1b2")).toBe(false);
    expect(isValidFingerprint(`${HEX}ff`)).toBe(false);
    expect(isValidFingerprint("")).toBe(false);
    expect(isValidFingerprint(null)).toBe(false);
  });
});

describe("deviceView", () => {
  const row: DeviceRow = {
    id: "d1",
    user_id: "u1",
    name: "Weft on Sam's MacBook",
    public_key: "pub-key",
    fingerprint: HEX,
    platform: "darwin",
    last_seen_at: "2026-10-01T10:00:00.000Z",
    revoked_at: null,
  };

  it("maps a device row and formats its fingerprint", () => {
    expect(deviceView(row, "Sam")).toEqual({
      id: "d1",
      ownerId: "u1",
      ownerName: "Sam",
      name: "Weft on Sam's MacBook",
      platform: "darwin",
      fingerprint: GROUPS,
      publicKey: "pub-key",
      lastSeenAt: "2026-10-01T10:00:00.000Z",
      revokedAt: null,
    });
  });

  it("keeps a null owner (the recovery device) and a missing owner name", () => {
    const recovery = deviceView({ ...row, user_id: null, fingerprint: "recovery" }, null);
    expect(recovery.ownerId).toBeNull();
    expect(recovery.ownerName).toBeNull();
    expect(recovery.fingerprint).toBe("recovery");
  });

  it("treats an absent owner name as null rather than undefined", () => {
    expect(deviceView(row).ownerName).toBeNull();
  });
});

describe("pendingGrantView", () => {
  const row: PendingGrantRow = {
    id: "p1",
    vault_id: "v1",
    granter_user_id: "u1",
    target_user_id: "u2",
    target_fingerprint: HEX,
    status: "pending",
    matched_device_id: null,
    created_at: "2026-10-01T10:00:00.000Z",
    expires_at: "2026-10-08T10:00:00.000Z",
  };

  it("maps a grant row with the looked-up names", () => {
    expect(pendingGrantView(row, { vaultLabel: "weft", granterName: "Sam", targetName: "Ada" })).toEqual({
      id: "p1",
      vaultId: "v1",
      vaultLabel: "weft",
      granterUserId: "u1",
      granterName: "Sam",
      targetUserId: "u2",
      targetName: "Ada",
      fingerprint: GROUPS,
      status: "pending",
      matchedDeviceId: null,
      createdAt: "2026-10-01T10:00:00.000Z",
      expiresAt: "2026-10-08T10:00:00.000Z",
    });
  });

  it("defaults the names and the label to empty rather than undefined", () => {
    const view = pendingGrantView(row);
    expect(view.vaultLabel).toBe("");
    expect(view.granterName).toBeNull();
    expect(view.targetName).toBeNull();
  });
});

describe("sortDevices", () => {
  const device = (id: string, ownerId: string | null, name: string, revokedAt: string | null = null) => ({
    id,
    ownerId,
    ownerName: null,
    name,
    platform: "darwin",
    fingerprint: GROUPS,
    publicKey: id,
    lastSeenAt: "2026-10-01T10:00:00.000Z",
    revokedAt,
  });

  it("puts the viewer's own devices first, then everyone else's", () => {
    const sorted = sortDevices([device("other", "u2", "Zed"), device("mine", "u1", "Ann")], "u1");
    expect(sorted.map((d) => d.id)).toEqual(["mine", "other"]);
  });

  it("sorts a revoked device below a live one in the same group", () => {
    const sorted = sortDevices([device("dead", "u1", "Ann", "2026-10-02T10:00:00.000Z"), device("live", "u1", "Ann")], "u1");
    expect(sorted.map((d) => d.id)).toEqual(["live", "dead"]);
  });

  it("sorts by name inside a group", () => {
    const sorted = sortDevices([device("b", "u1", "Bob"), device("a", "u1", "Ann")], "u1");
    expect(sorted.map((d) => d.name)).toEqual(["Ann", "Bob"]);
  });

  it("treats an unknown viewer as an outsider", () => {
    const sorted = sortDevices([device("mine", "u1", "Ann"), device("other", "u2", "Zed")], null);
    expect(sorted.map((d) => d.id)).toEqual(["mine", "other"]);
  });

  it("doesn't mutate the array it was given", () => {
    const list = [device("b", "u1", "Bob"), device("a", "u1", "Ann")];
    sortDevices(list, "u1");
    expect(list.map((d) => d.id)).toEqual(["b", "a"]);
  });
});

describe("sortPendingGrants", () => {
  const grant = (id: string, targetUserId: string, createdAt: string, status = "pending") => ({
    id,
    vaultId: "v1",
    vaultLabel: "weft",
    granterUserId: "u1",
    granterName: null,
    targetUserId,
    targetName: null,
    fingerprint: GROUPS,
    status,
    matchedDeviceId: null,
    createdAt,
    expiresAt: "2026-10-08T10:00:00.000Z",
  });

  it("puts the grants waiting on the viewer first, then the rest, newest first", () => {
    const sorted = sortPendingGrants(
      [grant("old", "u2", "2026-10-01T10:00:00.000Z"), grant("new", "u2", "2026-10-05T10:00:00.000Z"), grant("mine", "u1", "2026-10-02T10:00:00.000Z")],
      "u1",
    );
    expect(sorted.map((g) => g.id)).toEqual(["mine", "new", "old"]);
  });

  it("drops the grants that are no longer pending", () => {
    const sorted = sortPendingGrants([grant("done", "u2", "2026-10-01T10:00:00.000Z", "accepted"), grant("live", "u2", "2026-10-02T10:00:00.000Z")], "u1");
    expect(sorted.map((g) => g.id)).toEqual(["live"]);
  });
});

describe("platformLabel", () => {
  it("names the platforms we know", () => {
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("win32")).toBe("Windows");
  });

  it("shows anything else as itself, or Unknown", () => {
    expect(platformLabel("freebsd")).toBe("freebsd");
    expect(platformLabel("")).toBe("Unknown");
    expect(platformLabel(null)).toBe("Unknown");
    expect(platformLabel(undefined)).toBe("Unknown");
  });
});

describe("lastSeenLabel", () => {
  const now = Date.parse("2026-10-27T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads the recent past in words", () => {
    expect(lastSeenLabel(ago(5_000), now)).toBe("Just now");
    expect(lastSeenLabel(ago(60_000), now)).toBe("1 minute ago");
    expect(lastSeenLabel(ago(120_000), now)).toBe("2 minutes ago");
    expect(lastSeenLabel(ago(3_600_000), now)).toBe("1 hour ago");
    expect(lastSeenLabel(ago(86_400_000), now)).toBe("1 day ago");
    expect(lastSeenLabel(ago(3 * 86_400_000), now)).toBe("3 days ago");
    expect(lastSeenLabel(ago(40 * 86_400_000), now)).toBe("1 month ago");
    expect(lastSeenLabel(ago(400 * 86_400_000), now)).toBe("1 year ago");
  });

  it("is Never for a missing or unparseable timestamp", () => {
    expect(lastSeenLabel(null, now)).toBe("Never");
    expect(lastSeenLabel(undefined, now)).toBe("Never");
    expect(lastSeenLabel("not a date", now)).toBe("Never");
  });

  it("doesn't count a clock skew into the future as time passed", () => {
    expect(lastSeenLabel(new Date(now + 60_000).toISOString(), now)).toBe("Just now");
  });
});
