// Main signs your account's settings for your workers (electron/settings-sign.cjs): its message is lib/account-settings-sig.ts's
// byte for byte, it signs only one it builds from checked fields, and a worker's check takes what it signs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { accountSettingsMessage as tsMessage, settingsDigest, settingsRefusal } from "../lib/account-settings-sig";
import { fakeSafeStorage } from "./pairing.harness";
import { accountSettingsMessage, desktopSignerFor, settingsSignRoutes } from "./settings-sign.cjs";


const USER = "0b8a3c2e-1f4d-4e5a-9b6c-7d8e9f0a1b2c";
const settings = { threadPrompt: "be brief", pushOnDone: true };
type Route = (body: unknown) => Promise<{ signature: string; publicKey: string }>;

describe("accountSettingsMessage", () => {
  it("matches lib/account-settings-sig.ts", () => {
    expect(accountSettingsMessage(USER, 12, "ab")).toBe(tsMessage(USER, 12, "ab"));
  });
});

describe("POST /account-settings/sign", () => {
  it("signs with this Mac's device key, once opened, in a way a paired worker takes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-settings-sign-"));
    try {
      const signer = desktopSignerFor(dir, () => fakeSafeStorage());
      const route = settingsSignRoutes(signer)["POST /account-settings/sign"] as Route;
      const digest = settingsDigest(settings);
      const { signature, publicKey } = await route({ userId: USER, version: 5, digest });
      expect(await signer()).toBe(await signer());
      expect(settingsRefusal({ user_id: USER, settings, version: 5, signature, updated_at: "t" }, [publicKey], 0)).toBeNull();
      expect(settingsRefusal({ user_id: USER, settings: { ...settings, threadPrompt: "x" }, version: 5, signature, updated_at: "t" }, [publicKey], 0)).toMatch(/isn't your Mac's/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("signs nothing the caller wrote: a bad account, version or digest is refused before the key opens", async () => {
    const signer = vi.fn();
    const route = settingsSignRoutes(signer)["POST /account-settings/sign"] as Route;
    const digest = "a".repeat(64);
    await expect(route({ userId: "u-1\nweft-approval-v1", version: 1, digest })).rejects.toThrow("That names no account.");
    await expect(route({ userId: USER, version: 1.5, digest })).rejects.toThrow("That names no version.");
    await expect(route({ userId: USER, version: 0, digest })).rejects.toThrow("That names no version.");
    await expect(route({ userId: USER, version: 1, digest: "zz" })).rejects.toThrow("That names no settings.");
    await expect(route({ userId: USER, version: 1 })).rejects.toThrow("That names no settings.");
    await expect(route(undefined)).rejects.toThrow("That names no account.");
    expect(signer).not.toHaveBeenCalled();
  });
});
