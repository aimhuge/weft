// lib/app-share-keys.ts: a folder-app link asks Electron main to send its keys when they changed, each time Share…
// opens or saves it; anything else passes through untouched, and a push that fails comes back as the reason, never as
// a thrown share.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShareState } from "./app-share-types";

const shell = vi.hoisted(() => vi.fn());
vi.mock("./browser-tools", () => ({ shell }));
const { withKeys } = await import("./app-share-keys");

const FOLDER: AppShareState = {
  kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "public", hasPassword: false, shows: "folder",
  owner: "user", slug: "growth", orgId: null, publicUrl: null, owners: { user: null, orgs: [] }, manifest: null, preview: null, previewing: false,
};

beforeEach(() => shell.mockReset());

describe("withKeys", () => {
  it("asks main to send a folder link's keys if they changed, and says which went up", async () => {
    shell.mockResolvedValue({ ok: true, pushed: ["SUPABASE_SECRET_KEY", 7], missing: ["GA4_PROPERTY_ID"] });
    const out = await withKeys("app-1", FOLDER);
    expect(shell).toHaveBeenCalledWith("/apps/push-secrets", { appId: "app-1", ifChanged: true });
    expect(out).toEqual({ ...FOLDER, keys: { pushed: ["SUPABASE_SECRET_KEY"], missing: ["GA4_PROPERTY_ID"] } });
  });

  it("passes main's refusal through as the reason", async () => {
    shell.mockResolvedValue({ error: "Touch ID declined." });
    expect(await withKeys("app-1", FOLDER)).toMatchObject({ keys: { error: "Touch ID declined." } });
  });

  it("says nothing when the keys were unchanged or there were none to send", async () => {
    shell.mockResolvedValueOnce({ ok: true, pushed: [], missing: [], unchanged: true }).mockResolvedValueOnce({ ok: true });
    expect(await withKeys("app-1", FOLDER)).toBe(FOLDER);
    expect(await withKeys("app-1", FOLDER)).toBe(FOLDER);
  });

  it("keeps the link when main can't be reached", async () => {
    shell.mockRejectedValueOnce(new Error("The browser pane only exists in the desktop app")).mockRejectedValueOnce("down");
    expect(await withKeys("app-1", FOLDER)).toMatchObject({ id: "s1", keys: { error: "Your keys didn't go up: The browser pane only exists in the desktop app" } });
    expect(await withKeys("app-1", FOLDER)).toMatchObject({ keys: { error: "Your keys didn't go up: down" } });
  });

  it("leaves a page or site link, an unsaved link and a non-ok answer alone", async () => {
    const blob = { ...FOLDER, shows: "blob" as const };
    expect(await withKeys("app-1", blob)).toBe(blob);
    const unsaved = { ...FOLDER, id: null };
    expect(await withKeys("app-1", unsaved)).toBe(unsaved);
    const out: AppShareState = { kind: "signed-out" };
    expect(await withKeys("app-1", out)).toBe(out);
    expect(shell).not.toHaveBeenCalled();
  });
});
