import { describe, expect, it } from "vitest";
import type { TeamProjectVault } from "./team-types";
import { holdsValues, macsText, seenText, vaultChip, vaultOffer } from "./team-vault-view";
import type { VaultSummary } from "./vault-view";

const mac = (name: string, person = "Alex") => ({ name, person, lastSeen: null });
const local = (...names: string[]): TeamProjectVault => ({ shared: null, localOn: names.map((n) => mac(n)) });
const shared = (...names: string[]): TeamProjectVault => ({ shared: { vaultId: "v1", keyVersion: 1, devices: names.map((n) => mac(n)), asks: [] }, localOn: [] });
const here = (over: Partial<VaultSummary> = {}) => ({ id: "github:a/b", folder: "/x", label: "a/b", secrets: [{ name: "A", missing: false }], ...over }) as unknown as VaultSummary;
const blankHere = here({ secrets: [{ name: "A", missing: true }] as never });

describe("macsText", () => {
  it("names one or two, counts more", () => {
    expect(macsText(["m5air"])).toBe("m5air");
    expect(macsText(["m5air", "m1mini"])).toBe("m5air and m1mini");
    expect(macsText(["a", "b", "c"])).toBe("3 Macs");
    expect(macsText([])).toBe("");
  });
});

describe("holdsValues", () => {
  it("is true only with a value", () => {
    expect(holdsValues(here())).toBe(true);
    expect(holdsValues(blankHere)).toBe(false);
    expect(holdsValues(null)).toBe(false);
  });
});

describe("vaultChip", () => {
  it("says shared and to how many devices, listing them in the title", () => {
    expect(vaultChip(shared("m5air", "m1mini"), null)).toEqual({ tone: "shared", text: "Secrets shared · 2 devices", title: "Holding the key:\nm5air (Alex)\nm1mini (Alex)" });
    expect(vaultChip(shared("m5air"), null)?.text).toBe("Secrets shared · 1 device");
    expect(vaultChip(shared(), null)?.title).toBe("Shared with this workspace");
  });

  it("counts this Mac's own share before the server has it", () => {
    expect(vaultChip(local(), here({ shared: {} as never }))?.text).toBe("Secrets shared");
  });

  it("says this Mac when it holds the values, else the Macs the server names", () => {
    expect(vaultChip(local("m5air"), here())?.text).toBe("Secrets on this Mac only");
    expect(vaultChip(local("m5air"), blankHere)).toMatchObject({ tone: "local", text: "Secrets on m5air only" });
    expect(vaultChip(local("m5air"), null)?.title).toBe("Not shared yet. They're on:\nm5air (Alex)");
  });

  it("is nothing with no vault anywhere", () => {
    expect(vaultChip(local(), null)).toBeNull();
    expect(vaultChip(undefined, undefined)).toBeNull();
  });
});

describe("vaultOffer", () => {
  it("offers Devices… on a shared vault, to anyone", () => {
    expect(vaultOffer({ vault: shared("m5air"), desktop: false, canShare: false })).toEqual({ kind: "devices" });
  });

  it("offers nothing to share for a non-admin, or once this Mac shared it", () => {
    expect(vaultOffer({ vault: local("m5air"), desktop: false, canShare: false })).toBeNull();
    expect(vaultOffer({ vault: local(), here: here({ shared: {} as never }), desktop: true, canShare: true })).toBeNull();
  });

  it("shares here on a desktop holding the values", () => {
    expect(vaultOffer({ vault: local(), here: here(), desktop: true, canShare: true })).toEqual({ kind: "share" });
  });

  it("names the Mac to share from on a desktop without them", () => {
    expect(vaultOffer({ vault: local("m5air"), here: blankHere, desktop: true, canShare: true })).toEqual({ kind: "elsewhere", on: "m5air" });
    expect(vaultOffer({ vault: local(), desktop: true, canShare: true })).toBeNull();
    expect(vaultOffer({ desktop: true, canShare: true })).toBeNull();
  });

  it("links to the desktop app from a browser, when some Mac has them", () => {
    expect(vaultOffer({ vault: local("m5air"), desktop: false, canShare: true })).toEqual({ kind: "link", on: "m5air" });
    expect(vaultOffer({ vault: local(), desktop: false, canShare: true })).toBeNull();
  });
});

describe("seenText", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("reads a last beat as a short age", () => {
    expect(seenText(null, now)).toBe("");
    expect(seenText("nonsense", now)).toBe("");
    expect(seenText("2026-11-05T11:59:30Z", now)).toBe("seen just now");
    expect(seenText("2026-11-05T11:40:00Z", now)).toBe("seen 20 min ago");
    expect(seenText("2026-11-05T11:00:00Z", now)).toBe("seen 1 hour ago");
    expect(seenText("2026-11-05T02:00:00Z", now)).toBe("seen 10 hours ago");
    expect(seenText("2026-11-01T12:00:00Z", now)).toBe("seen 4 days ago");
  });
});
