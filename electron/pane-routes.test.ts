import { describe, expect, it, vi } from "vitest";
import { paneRoutes as rawRoutes, statusRoute } from "./pane-routes.cjs";

type Route = (body: Record<string, unknown>) => unknown;
type Api = { status: (folders: string[]) => unknown } | undefined;

function make(over: Record<string, unknown> = {}) {
  const sendMenu = vi.fn();
  const addBlanks = vi.fn(() => Promise.resolve());
  const vercel = { status: vi.fn((folders: string[]) => ({ folders, from: "vercel" })) };
  const deps = {
    dataDir: "/tmp/weft-data", app: {}, dialog: {}, systemPreferences: {} as never, shell: {}, window: () => null, board: () => null,
    sendMenu, updater: () => ({}), vault: () => ({ addBlanks }), vercelEnv: () => null,
    vercelApi: () => vercel, supabaseApi: () => undefined, ...over,
  };
  const routes = rawRoutes(deps) as unknown as Record<string, Route>;
  return { routes, sendMenu, addBlanks, vercel };
}

describe("paneRoutes", () => {
  it("serves every route main used to declare inline", () => {
    const keys = Object.keys(make().routes);
    for (const key of ["POST /secrets/ask-add", "POST /folder-access/ask", "POST /app/restart", "POST /webhooks/ask-add", "POST /webhooks/relay-seal",
      "POST /vercel/status", "POST /supabase/status", "POST /vercel/env-push"]) expect(keys).toContain(key);
  });

  it("asks a person before a tunnel opens, and passes on their answer", async () => {
    for (const allowed of [true, false]) {
      const promptTouchID = vi.fn(() => (allowed ? Promise.resolve() : Promise.reject(new Error("no"))));
      const { routes } = make({ systemPreferences: { canPromptTouchID: () => true, promptTouchID } });
      await expect(routes["POST /tunnels/approve"]!({ folder: "/p", target: "http://localhost:4000/", hours: 4 })).resolves.toEqual({ approved: allowed });
      expect(promptTouchID).toHaveBeenCalledWith("open a private tunnel to http://localhost:4000/ from /p for 4 hours");
    }
  });

  it("puts an asked-for key in as a development blank by default", async () => {
    const { routes, addBlanks } = make();
    await expect(routes["POST /secrets/ask-add"]!({ folder: "/p", name: "KEY" })).resolves.toEqual({ added: true });
    expect(addBlanks).toHaveBeenCalledWith("/p", ["KEY"], ["development"], { source: "a thread" });
  });

  it("still answers when the vault isn't set up or the add fails", async () => {
    await expect(make({ vault: () => undefined }).routes["POST /secrets/ask-add"]!({ folder: "/p", name: "K" })).resolves.toEqual({ added: true });
    const failing = { addBlanks: () => Promise.reject(new Error("locked")) };
    await expect(make({ vault: () => failing }).routes["POST /secrets/ask-add"]!({ folder: "/p", name: "K" })).resolves.toEqual({ added: true });
  });

  it("opens 🪝 on the board for a recorded webhook", () => {
    const { routes, sendMenu } = make();
    expect(routes["POST /webhooks/ask-add"]!({ folder: "/p", id: "stripe" })).toEqual({ ok: true });
    expect(sendMenu).toHaveBeenCalledWith("add-webhook", JSON.stringify({ folder: "/p", id: "stripe" }));
  });

  it("seals the vault value for the relay row, and hands back only the ciphertext trio", async () => {
    // Touch ID lives inside vault.sendValue; this stubs it to hand the value straight to the sealler.
    // The value is asserted inside send() — if it weren't reaching the seal, nothing would return.
    process.env.WEFT_RELAY_SECRET_KEY = "11".repeat(32);
    const vault = () => ({
      sendValue: (_folder: string, name: string, _env: string, reason: (label: string) => string, seal: (v: string) => unknown) =>
        Promise.resolve({ ...(seal("whsec_test") as object), label: "label", reason: reason("label"), name }),
    });
    const { routes } = make({ vault });
    try {
      const r = (await routes["POST /webhooks/relay-seal"]!({ folder: "/p", name: "STRIPE_WEBHOOK_SECRET", environment: "development", provider: "stripe" })) as Record<string, string>;
      expect(r.reason).toContain("STRIPE_WEBHOOK_SECRET");
      expect(r.name).toBe("STRIPE_WEBHOOK_SECRET");
      expect(r.secret_key_id).toBe("v1");
      // Ciphertext, not the secret: nothing here lets a reader recover "whsec_test".
      expect(r.secret_ciphertext).toMatch(/^[0-9a-f]+$/);
      expect(r.secret_nonce).toHaveLength(24);
      expect(JSON.stringify(r)).not.toContain("whsec_test");
    } finally {
      delete process.env.WEFT_RELAY_SECRET_KEY;
    }
  });

  it("refuses an unknown provider and an absent relay key", () => {
    process.env.WEFT_RELAY_SECRET_KEY = "11".repeat(32);
    const vault = () => ({ sendValue: () => Promise.resolve({}) });
    const { routes } = make({ vault });
    expect(() => routes["POST /webhooks/relay-seal"]!({ folder: "/p", name: "S", environment: "development", provider: "acme" })).toThrow("Unknown provider");
    // An absent (or non-hex) env key refuses too, so a misconfigured Mac never seals with a guess.
    delete process.env.WEFT_RELAY_SECRET_KEY;
    expect(() => routes["POST /webhooks/relay-seal"]!({ folder: "/p", name: "S", environment: "development", provider: "stripe" })).toThrow(/not configured/);
  });

  it("reads Vercel's status per folder, and an empty one while Supabase isn't set up", () => {
    const { routes, vercel } = make();
    expect(routes["POST /vercel/status"]!({ folders: ["/a", 7] })).toEqual({ folders: ["/a", "7"], from: "vercel" });
    expect(vercel.status).toHaveBeenCalledWith(["/a", "7"]);
    expect(routes["POST /supabase/status"]!({ folders: ["/a"] })).toEqual({ folders: [] });
  });
});

describe("statusRoute", () => {
  it("treats a missing folder list as none", () => {
    const api: Api = { status: vi.fn(() => ({ folders: ["x"] })) };
    expect(statusRoute(() => api)({} as { folders: string[] })).toEqual({ folders: ["x"] });
    expect(api.status).toHaveBeenCalledWith([]);
  });
});
