import { describe, expect, it, vi } from "vitest";

const service = { from: vi.fn() };
vi.mock("./web-session", () => ({ serviceClient: (env: Record<string, string | undefined>) => (env.SUPABASE_SECRET_KEY ? service : null) }));

const { connectorDeps, NOT_SET_UP } = await import("./connector-deps");

const ENV = { SUPABASE_SECRET_KEY: "sk", GITHUB_APP_CLIENT_ID: "id", GITHUB_APP_CLIENT_SECRET: "s", WEFT_CONNECTOR_TOKEN_KEY: "ab".repeat(32) };

describe("connectorDeps", () => {
  it("builds the database, OAuth client, key, fetch and clock from the env", () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const d = connectorDeps(ENV, fetcher);
    expect(d).toMatchObject({ cfg: { clientId: "id", clientSecret: "s" }, key: { id: "v1" }, fetch: fetcher, now: Date.now });
    expect(typeof d?.db.tokens).toBe("function");
  });

  it("is null when any piece is missing", () => {
    for (const name of Object.keys(ENV)) expect(connectorDeps({ ...ENV, [name]: undefined })).toBeNull();
  });

  it("reads process.env and the global fetch by default", () => {
    const d = connectorDeps();
    expect(d === null || d.fetch === fetch).toBe(true);
  });

  it("names why it's not set up", () => {
    expect(NOT_SET_UP.error).toContain("aren't set up");
  });
});
