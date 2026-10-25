// What electron/app-read-core.cjs gained when the hosted route (app/api/a/[id]/read/route.ts) started
// running the same reads as main. The reads' common behaviour is tested through main's front door in
// electron/app-data-reads.test.ts; these are the options and messages the two callers share.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exchangeToken, runGa4, runSupabase } from "./app-read-core.cjs";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const PRIVATE_KEY_PEM = typeof pem === "string" ? pem : "";
const SUPABASE = { supabaseUrl: "https://abc.supabase.co", fn: "fn", declaredArgs: {}, pageArgs: {}, values: { SUPABASE_SECRET_KEY: "x" } };

function answer(status: number, text: string) {
  return () => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(text) });
}

describe("app-read-core", () => {
  it("sends only the page's args with defaults: false", async () => {
    const calls: string[] = [];
    const fetch = (url: string) => { calls.push(url); return answer(200, "[]")(); };
    await runSupabase({ ...SUPABASE, declaredArgs: { days: 30, obj: { a: 1 } }, pageArgs: { obj: { b: 2 } }, fetch, defaults: false });
    expect(calls[0]).not.toContain("days=");
    expect(calls[0]).not.toContain("obj=");
  });

  it("carries the upstream's status on an upstream refusal", async () => {
    await expect(runSupabase({ ...SUPABASE, fetch: answer(404, JSON.stringify({ message: "nope" })) })).rejects.toMatchObject({ kind: "upstream", status: 404 });
  });

  it("names the network's reason when the host can't be reached", async () => {
    const down = () => Promise.reject(new Error("ECONNREFUSED"));
    await expect(runSupabase({ ...SUPABASE, fetch: down })).rejects.toMatchObject({ kind: "network", message: "Couldn't reach Supabase: ECONNREFUSED." });
  });

  it("refuses a service account without its private key, before signing", async () => {
    const values = { GA4_PROPERTY_ID: "1", GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "a@b" }) };
    await expect(runGa4({ body: {}, values, fetch: answer(200, "{}"), tokens: new Map() })).rejects.toMatchObject({ kind: "missing" });
  });

  it("treats a token reply without expires_in as an hour", async () => {
    const got = await exchangeToken({ clientEmail: "sa@x", privateKey: PRIVATE_KEY_PEM, fetch: answer(200, JSON.stringify({ access_token: "t" })), now: () => 0 });
    expect(got).toEqual({ accessToken: "t", expiresAt: 3600_000 - 60_000 });
  });

  it("refuses a token reply without an access token", async () => {
    await expect(exchangeToken({ clientEmail: "sa@x", privateKey: PRIVATE_KEY_PEM, fetch: answer(200, "{}"), now: () => 0 })).rejects.toMatchObject({ kind: "upstream" });
  });
});
