// A new card from the web never starts looser than the web may set: not by naming a mode, and not by leaving it to the
// Mac's default (lib/cloud-new-card-mode.ts).
import { describe, expect, it, vi } from "vitest";
import { networkStartMode } from "./cloud-new-card-mode";
import type { PermissionMode } from "./types";

const PHONE = "phone is paired";
const deps = (def: PermissionMode, refused: string | null = null) => ({ defaultMode: () => def, refusal: vi.fn(() => Promise.resolve(refused)) });

describe("networkStartMode", () => {
  it("starts in default as asked, and plan as default (a Mac has no plan mode), whatever the pairing or the default", async () => {
    const d = deps("bypassPermissions", PHONE);
    await expect(networkStartMode("default", d)).resolves.toBe("default");
    await expect(networkStartMode("plan", d)).resolves.toBe("default");
    expect(d.refusal).not.toHaveBeenCalled();
  });

  it("starts in a looser mode it names only while the web may approve", async () => {
    await expect(networkStartMode("auto", deps("default"))).resolves.toBe("auto");
    await expect(networkStartMode("acceptEdits", deps("default", PHONE))).rejects.toThrow(PHONE);
  });

  it("never starts in bypassPermissions, named or as the Mac's default", async () => {
    await expect(networkStartMode("bypassPermissions", deps("default"))).rejects.toThrow(/skip permission prompts/);
    await expect(networkStartMode(undefined, deps("bypassPermissions"))).resolves.toBe("default");
  });

  it("takes the Mac's default when the row names none, and falls back to default when the web may not set it", async () => {
    await expect(networkStartMode(undefined, deps("default"))).resolves.toBe("default");
    await expect(networkStartMode(undefined, deps("auto"))).resolves.toBe("auto");
    const d = deps("auto", PHONE);
    await expect(networkStartMode(undefined, d)).resolves.toBe("default");
    expect(d.refusal).toHaveBeenCalledWith("auto");
  });
});
