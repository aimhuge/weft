import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relaySealRoutes } from "./relay-seal.cjs";

// Several webhooks' relay secrets sealed under one approval (vault.sendValues); the single route is in pane-routes.test.ts.
type Route = (body: Record<string, unknown>) => unknown;
type Send = (values: Record<string, string>) => unknown;

beforeEach(() => {
  process.env.WEFT_RELAY_SECRET_KEY = "11".repeat(32);
});
afterEach(() => {
  delete process.env.WEFT_RELAY_SECRET_KEY;
});

function make(answer?: (names: string[], reason: string, send: Send) => unknown) {
  const sendValues = vi.fn((_folder: string, names: string[], _env: string, reason: (label: string) => string, send: Send) =>
    Promise.resolve(answer ? answer(names, reason("Owner/Repo"), send) : { ...(send(Object.fromEntries(names.map((n) => [n, `whsec_${n}`]))) as object), label: "Owner/Repo" }),
  );
  const routes = relaySealRoutes(() => ({ sendValues })) as unknown as Record<string, Route>;
  return { sendValues, seal: (body: Record<string, unknown>) => routes["POST /webhooks/relay-seal-many"]!({ folder: "/p", ...body }) };
}

describe("POST /webhooks/relay-seal-many", () => {
  it("asks once for every secret, naming each provider, and hands back only a ciphertext trio per name", async () => {
    const { sendValues, seal } = make();
    const r = (await seal({ hooks: [{ name: "STRIPE_WEBHOOK_SECRET", provider: "stripe" }, { name: "GH_SECRET", provider: "github" }, { name: "GH_SECRET", provider: "github" }] })) as {
      sealed: Record<string, { secret_ciphertext: string; secret_nonce: string; secret_key_id: string }>;
    };
    expect(sendValues).toHaveBeenCalledTimes(1);
    const [folder, names, env, reason] = sendValues.mock.calls[0]!;
    expect([folder, names, env]).toEqual(["/p", ["STRIPE_WEBHOOK_SECRET", "GH_SECRET"], "development"]);
    expect(reason("Owner/Repo")).toBe(
      "seal 3 webhook signing secrets (Owner/Repo, development) and store them on the relay: stripe STRIPE_WEBHOOK_SECRET, github GH_SECRET, github GH_SECRET",
    );
    expect(Object.keys(r.sealed)).toEqual(["STRIPE_WEBHOOK_SECRET", "GH_SECRET"]);
    expect(r.sealed.GH_SECRET?.secret_key_id).toBe("v1");
    expect(r.sealed.GH_SECRET?.secret_nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(r)).not.toContain("whsec_");
  });

  it("passes a denial or missing names straight back", async () => {
    expect(await make((names) => ({ missing: names, label: "Owner/Repo" })).seal({ hooks: [{ name: "S", provider: "svix" }] })).toEqual({ missing: ["S"], label: "Owner/Repo" });
    expect(await make(() => ({ denied: true, label: "Owner/Repo" })).seal({ hooks: [{ name: "S", provider: "svix" }] })).toEqual({ denied: true, label: "Owner/Repo" });
  });

  it("refuses an empty or oversized list, a nameless hook, an unknown provider and an absent relay key", () => {
    const { seal, sendValues } = make();
    expect(() => seal({ hooks: [] })).toThrow(/at least one/);
    expect(() => seal({ hooks: Array.from({ length: 21 }, () => ({ name: "S", provider: "stripe" })) })).toThrow(/At most 20/);
    expect(() => seal({ hooks: [{ name: "", provider: "stripe" }] })).toThrow(/vault name/);
    expect(() => seal({ hooks: [{ name: "S", provider: "acme" }] })).toThrow("Unknown provider");
    delete process.env.WEFT_RELAY_SECRET_KEY;
    expect(() => seal({ hooks: [{ name: "S", provider: "stripe" }] })).toThrow(/not configured/);
    expect(sendValues).not.toHaveBeenCalled();
  });
});
