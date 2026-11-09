import { describe, expect, it } from "vitest";
import { offersShare, vaultStatus } from "./vault-status";
import type { VaultSummary } from "./vault-view";

const v = (over: Partial<VaultSummary> = {}): VaultSummary => ({ id: "github:o/web", label: "o/web", folder: "/w", folders: ["/w"], secrets: [], nudge: null, ...over });
const shared = { org: { id: "o1", slug: "acme", name: "Acme" }, vaultId: "v1", keyVersion: 2, serverVersion: 1, recoveryShownAt: null };
const join = (state: "none" | "asked" | "granted") => ({ vaultId: "v1", orgId: "o1", repo: "o/web", state, fingerprint: "ab" });
const value = { name: "A", environment: "development" as const, missing: false, tail: "", updatedAt: "" };

describe("vaultStatus", () => {
  it("leads with Macs asking to join", () => {
    expect(vaultStatus(v({ shared, requests: [{ id: "p", person: "S", deviceName: "m", fingerprint: "f" }] }))).toEqual({ text: "1 Mac asks to join", action: "Review", tone: "accent" });
    expect(vaultStatus(v({ requests: [1, 2].map((i) => ({ id: `p${i}`, person: "S", deviceName: "m", fingerprint: "f" })) }))?.text).toBe("2 Macs ask to join");
  });

  it("walks a join: not asked, asked, approved", () => {
    expect(vaultStatus(v({ join: join("none") }))?.action).toBe("Ask to join");
    expect(vaultStatus(v({ join: join("asked") }))).toMatchObject({ action: "Details", tone: "quiet" });
    expect(vaultStatus(v({ join: join("granted") }))?.action).toBe("Open shared vault");
  });

  it("names the workspace and key of a shared vault", () => {
    expect(vaultStatus(v({ shared }))).toEqual({ text: "Shared with Acme · key v2", action: null, tone: "quiet" });
    expect(vaultStatus(v({ shared: { ...shared, org: { ...shared.org, name: "" } } }))?.text).toBe("Shared with a workspace · key v2");
  });

  it("leads with this Mac's own standing: removed, or couldn't register", () => {
    expect(vaultStatus(v({ joinHint: "revoked", requests: [{ id: "p", person: "S", deviceName: "m", fingerprint: "f" }] }))).toEqual({ text: "This Mac was removed from your account, so it can't share or join.", action: "Re-add it", tone: "accent" });
    expect(vaultStatus(v({ joinHint: "unregistered", secrets: [value] }))?.action).toBe("Try again");
  });

  it("offers Share… only on a local vault of a Mac that may share", () => {
    expect(offersShare(v())).toBe(true);
    expect(offersShare(v({ joinHint: "none" }))).toBe(true);
    expect(offersShare(v({ joinHint: "revoked" }))).toBe(false);
    expect(offersShare(v({ shared }))).toBe(false);
    expect(offersShare(v({ join: join("none") }))).toBe(false);
  });

  it("says why there's no join, with Sign in when signed out", () => {
    expect(vaultStatus(v({ joinHint: "signed-out" }))?.action).toBe("Sign in");
    expect(vaultStatus(v({ joinHint: "error" }))?.action).toBeNull();
  });

  it("offers Share… for a GitHub vault holding values here, else nothing", () => {
    expect(vaultStatus(v({ secrets: [value] }))).toEqual({ text: "On this Mac only", action: "Share…", tone: "quiet" });
    expect(vaultStatus(v())).toBeNull();
    expect(vaultStatus(v({ id: "folder:/w", secrets: [value] }))).toBeNull();
  });
});
