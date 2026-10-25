// electron/app-secrets-push.cjs for an app whose data comes from named reads (Growth): its weft-app.json has no
// `secrets` block, yet on weft.zip its reads run with the author's SUPABASE_SECRET_KEY and GA4 pair, so Upload
// secrets must send those. Split from app-secrets-push.test.ts, which is at the 300-line cap.
import { describe, expect, it, vi } from "vitest";
import { appSecretsRoutes, namesToPush, pushTargets, vaultFolderOf } from "./app-secrets-push.cjs";
import { parsePolicy } from "./app-fetch-policy.cjs";

const READS = { signups: { supabase: "growth_signups_by_day" }, traffic: { ga4: {} } };
const policy = parsePolicy({ name: "📈 Growth", folder: "/x", env: "production", supabaseUrl: null, reads: READS, secrets: {}, public: [] });

describe("pushing a read-only app's keys", () => {
  it("names the keys the reads run with", () => {
    expect(namesToPush(policy, READS)).toEqual(["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON", "SUPABASE_SECRET_KEY"]);
  });

  it("says where they go on the Touch ID sheet", () => {
    expect(pushTargets(policy, READS)).toEqual(["GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_JSON, SUPABASE_SECRET_KEY → the app's reads"]);
  });

  it("adds nothing for an app without reads", () => {
    expect(namesToPush(policy)).toEqual([]);
    expect(pushTargets(policy)).toEqual([]);
  });
});

describe("vaultFolderOf", () => {
  it("reads the vault of the project the manifest names, as the Mac's reads do", () => {
    expect(vaultFolderOf({ folder: "/Users/me/dev/weft" }, "/Users/me/.weft/apps/growth")).toBe("/Users/me/dev/weft");
  });

  it("falls back to the app folder when the manifest names none", () => {
    expect(vaultFolderOf({}, "/Users/me/.weft/apps/growth")).toBe("/Users/me/.weft/apps/growth");
    expect(vaultFolderOf({ folder: "" }, "/Users/me/.weft/apps/growth")).toBe("/Users/me/.weft/apps/growth");
  });
});

describe("appSecretsRoutes", () => {
  it("runs the push for the app Weft's server names", async () => {
    const push = vi.fn(() => Promise.resolve({ ok: true, pushed: ["SUPABASE_SECRET_KEY"], missing: [] }));
    const route = appSecretsRoutes(() => ({ push }))["POST /apps/push-secrets"];
    await expect(route({ appId: "app-1" })).resolves.toEqual({ ok: true, pushed: ["SUPABASE_SECRET_KEY"], missing: [] });
    await route({});
    expect(push).toHaveBeenLastCalledWith("", { ifChanged: false });
  });

  it("refuses before main has set the push up", () => {
    expect(() => appSecretsRoutes(() => null)["POST /apps/push-secrets"]({ appId: "app-1" })).toThrow("Upload secrets isn't ready yet.");
    expect(() => appSecretsRoutes()["POST /apps/push-secrets"]({ appId: "app-1" })).toThrow("Upload secrets isn't ready yet.");
  });
});
