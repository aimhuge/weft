import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_SHARE_BYTES } from "./billing/plans";
import { overMessage, pageBytes, quotaErrorText, quotaRefusal, readQuota, roomFor } from "./app-share-quota";

const MB = 1024 * 1024;
const rpcClient = (answer: unknown) => {
  const rpc = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
};

describe("readQuota", () => {
  it("reads the plan, the bytes in use and the cap, leaving one link out", async () => {
    const { client, rpc } = rpcClient({ data: [{ plan: "pro", used: "1048576", cap: 1073741824 }], error: null });
    expect(await readQuota(client, "o1", "s1")).toEqual({ plan: "pro", planName: "Pro", used: MB, cap: 1024 * MB });
    expect(rpc).toHaveBeenCalledWith("app_share_quota", { org: "o1", except_share: "s1" });
  });

  it("takes a single row and an unknown plan as Free", async () => {
    const { client } = rpcClient({ data: { plan: "gold", used: 0, cap: 5 }, error: null });
    expect(await readQuota(client, "o1")).toEqual({ plan: "free", planName: "Free", used: 0, cap: 5 });
  });

  it("answers null when the database can't say", async () => {
    for (const answer of [{ data: null, error: { message: "no function" } }, { data: [], error: null }, { data: [{ plan: 1 }], error: null }, { data: [{ plan: "pro", used: "x", cap: 1 }], error: null }, new Error("offline")]) {
      expect(await readQuota(rpcClient(answer).client, "o1")).toBeNull();
    }
  });
});

describe("pageBytes", () => {
  it("weighs a single page, a folder and a site", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-"));
    const file = path.join(dir, "index.html");
    fs.writeFileSync(file, "x".repeat(1234));
    expect(pageBytes({ kind: "blob", local: file })).toBe(1234);
    expect(pageBytes({ kind: "blob", local: path.join(dir, "gone.html") })).toBe(0);
    expect(pageBytes({ kind: "folder", files: [{ size: 10 }, { size: 5 }] })).toBe(15);
    expect(pageBytes({ kind: "site" })).toBe(0);
  });
});

describe("overMessage", () => {
  it("names the plan, the cap, what's used and where more room is", () => {
    expect(overMessage("free", 12 * MB, 25 * MB, 31 * MB)).toBe(
      "This app is 31 MB, and the Free plan's shared apps have 25 MB, 12 MB of it in use. Make another app's link private, or move to Pro for more room.",
    );
    expect(overMessage("oss", 0, 1024 * MB, 2048 * MB)).toMatch(/Open Source plan.*move to Team/);
    expect(overMessage("team", 0, 5120 * MB, 6000 * MB)).toMatch(/private to free room\.$/);
  });
});

describe("quotaRefusal", () => {
  const quota = { plan: "free", planName: "Free", used: 20 * MB, cap: 25 * MB };
  it("refuses only an open link that goes past the cap", () => {
    expect(quotaRefusal(quota, "public", 6 * MB)).toMatch(/This app is 6 MB/);
    expect(quotaRefusal(quota, "password", 5 * MB)).toBeNull();
    expect(quotaRefusal(quota, "private", 100 * MB)).toBeNull();
    expect(quotaRefusal(quota, "public", 0)).toBeNull();
    expect(quotaRefusal(null, "public", 100 * MB)).toBeNull();
  });
});

describe("quotaErrorText", () => {
  it("reads the trigger's refusal and passes anything else", () => {
    expect(quotaErrorText(`app_share_quota: ${31 * MB} of ${25 * MB} bytes on the free plan`, 6 * MB)).toMatch(/This app is 6 MB.*25 MB, 25 MB of it in use/);
    expect(quotaErrorText(`app_share_quota: ${MB} of ${25 * MB} bytes on the free plan`, 2 * MB)).toMatch(/0 KB of it in use/);
    expect(quotaErrorText("duplicate key", 1)).toBeNull();
  });
});

describe("roomFor", () => {
  it("checks the page's size against the room, skipping private links and empty pages", async () => {
    const { client, rpc } = rpcClient({ data: [{ plan: "free", used: 20 * MB, cap: 25 * MB }], error: null });
    expect(await roomFor(client, "o1", "s1", "public", { kind: "folder", files: [{ size: 6 * MB }] })).toMatch(/6 MB/);
    expect(await roomFor(client, "o1", "s1", "public", { kind: "folder", files: [{ size: MB }] })).toBeNull();
    expect(await roomFor(client, "o1", "s1", "private", { kind: "folder", files: [{ size: 99 * MB }] })).toBeNull();
    expect(await roomFor(client, "o1", "s1", "public", { kind: "site" })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("the database's caps", () => {
  it("match APP_SHARE_BYTES", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261024124411_app_share_quota.sql"), "utf8");
    const caps: Record<string, number> = {};
    for (const m of sql.matchAll(/when '(\w+)' then (\d+)::bigint/g)) caps[m[1] as string] = Number(m[2]);
    const fallback = /else (\d+)::bigint/.exec(sql);
    expect(caps).toEqual({ pro: APP_SHARE_BYTES.pro, oss: APP_SHARE_BYTES.oss, edu: APP_SHARE_BYTES.edu, team: APP_SHARE_BYTES.team });
    expect(Number(fallback?.[1])).toBe(APP_SHARE_BYTES.free);
  });
});
