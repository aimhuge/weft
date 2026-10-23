// electron/app-secrets-push.cjs for an app whose data comes from named reads (Growth): its weft-app.json has no
// `secrets` block, yet on weft.zip its reads run with the author's SUPABASE_SECRET_KEY and GA4 pair, so Upload
// secrets must send those. Split from app-secrets-push.test.ts, which is at the 300-line cap.
import { describe, expect, it } from "vitest";
import { namesToPush, pushTargets } from "./app-secrets-push.cjs";
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
