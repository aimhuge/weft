import { describe, expect, it, vi } from "vitest";
import { createVercelEnv, envRoutes } from "./vercel-env.cjs";

// Vault → Vercel: the names on each side, and a push that only main sees the value of.

type Env = { id?: string | null; key: string; targets: string[]; type?: string | null };

function make(envs: Env[] = [], values: Record<string, string | null> = {}, pushable: Record<string, Record<string, string>> = {}) {
  const vault = {
    names: vi.fn(() =>
      Promise.resolve({
        label: "aimhuge/weft",
        secrets: [
          { name: "KEY", environment: "production", missing: false },
          { name: "KEY", environment: "development", missing: false },
          { name: "TODO", environment: "production", missing: true },
        ],
      }),
    ),
    sendValue: vi.fn((_folder: string, _name: string, _env: string, reason: (label: string) => string, send: (value: string) => Promise<unknown>) =>
      send(`value-for-${reason("aimhuge/weft")}`).then((r) => ({ ...(r as object), label: "aimhuge/weft" })),
    ),
    valuesFor: vi.fn((_folder: string, _names: null, environment: string) => Promise.resolve({ label: "aimhuge/weft", values: pushable[environment] ?? {} })),
    confirm: vi.fn(() => Promise.resolve(true)),
    setValue: vi.fn(() => Promise.resolve({ saved: true })),
  };
  const vercel = {
    envList: vi.fn(() => Promise.resolve({ project: "weft", envs })),
    envSet: vi.fn(() => Promise.resolve({ pushed: true, project: "weft" })),
    envValue: vi.fn((_folder: string, id: string) => Promise.resolve(values[id] ?? null)),
    createWebhook: vi.fn(() => Promise.resolve({ id: "hook_1", secret: "s" })),
    deleteWebhook: vi.fn(() => Promise.resolve({ removed: true })),
  };
  return { env: createVercelEnv({ vercel, vault }), vault, vercel };
}

describe("vercel-env", () => {
  it("lines up the vault's names with Vercel's, by environment", async () => {
    const { env } = make([
      { key: "KEY", targets: ["development", "preview"] },
      { key: "OTHER", targets: ["production", "preview"] },
      { key: "ODD", targets: ["staging"] },
    ]);
    expect(await env.status("/dev/weft")).toEqual({
      label: "aimhuge/weft",
      project: "weft",
      rows: [
        { name: "KEY", environment: "development", inVault: true, onVercel: true },
        { name: "KEY", environment: "preview", inVault: false, onVercel: true },
        { name: "OTHER", environment: "preview", inVault: false, onVercel: true },
        { name: "KEY", environment: "production", inVault: true, onVercel: false },
        { name: "OTHER", environment: "production", inVault: false, onVercel: true },
        { name: "TODO", environment: "production", inVault: false, onVercel: false },
      ],
    });
  });

  it("pushes one value after a Touch ID that names it, the vault, the environment and the project", async () => {
    const { env, vault, vercel } = make();
    expect(await env.push("/dev/weft", "KEY", "production")).toEqual({ pushed: true, project: "weft", label: "aimhuge/weft" });
    expect(vault.sendValue).toHaveBeenCalledWith("/dev/weft", "KEY", "production", expect.any(Function), expect.any(Function), "");
    expect(vercel.envSet).toHaveBeenCalledWith("/dev/weft", "KEY", "production", "value-for-push KEY (aimhuge/weft, production) to Vercel project weft");
  });

  // The card that asked is passed on, so its grant can cover the push (2026-10-29).
  it("passes the card that asked on to the send, so its grant can cover the push", async () => {
    const { env, vault } = make();
    await env.push("/dev/weft", "KEY", "production", "c1");
    expect(vault.sendValue).toHaveBeenCalledWith("/dev/weft", "KEY", "production", expect.any(Function), expect.any(Function), "c1");
  });

  describe("push all", () => {
    const values = { development: { KEY: "dev-value" }, production: { KEY: "prod-value", OTHER: "other-value" } };

    it("pushes every vault value in every environment after one Touch ID that says how many", async () => {
      const { env, vault, vercel } = make([], {}, values);
      expect(await env.pushAll("/dev/weft")).toEqual({
        label: "aimhuge/weft",
        project: "weft",
        sent: [
          { name: "KEY", environment: "development" },
          { name: "KEY", environment: "production" },
          { name: "OTHER", environment: "production" },
        ],
        failed: [],
      });
      expect(vault.confirm).toHaveBeenCalledTimes(1);
      expect(vault.confirm).toHaveBeenCalledWith("push 3 secrets (aimhuge/weft) to Vercel project weft");
      expect(vercel.envSet).toHaveBeenCalledWith("/dev/weft", "OTHER", "production", "other-value");
    });

    it("carries on past a refusal and names it, including a non-Error throw", async () => {
      const { env, vercel } = make([], {}, values);
      vercel.envSet.mockRejectedValueOnce(new Error("Vercel answered 500.")).mockImplementationOnce(() => {
        throw "boom"; // eslint-disable-line @typescript-eslint/only-throw-error
      });
      const r = await env.pushAll("/dev/weft");
      expect(r.failed).toEqual([
        { name: "KEY", environment: "development", error: "Vercel answered 500." },
        { name: "KEY", environment: "production", error: "boom" },
      ]);
      expect(r.sent).toEqual([{ name: "OTHER", environment: "production" }]);
    });

    it("asks nothing with no values, and sends nothing when Touch ID says no", async () => {
      const empty = make();
      expect(await empty.env.pushAll("/dev/weft")).toEqual({ label: "aimhuge/weft", project: "weft", sent: [], failed: [] });
      expect(empty.vault.confirm).not.toHaveBeenCalled();
      const { env, vault, vercel } = make([], {}, { preview: { KEY: "v" } });
      vault.confirm.mockResolvedValueOnce(false);
      expect(await env.pushAll("/dev/weft")).toEqual({ label: "aimhuge/weft", project: "weft", denied: true });
      expect(vercel.envSet).not.toHaveBeenCalled();
    });
  });

  it("refuses a bad name or environment before asking anyone", async () => {
    const { env, vault } = make();
    await expect(env.push("/dev/weft", "1BAD", "production")).rejects.toThrow("isn't a variable name");
    await expect(env.push("/dev/weft", "", "production")).rejects.toThrow("A blank name");
    await expect(env.push("/dev/weft", "KEY", "staging")).rejects.toThrow("Unknown environment");
    expect(vault.sendValue).not.toHaveBeenCalled();
  });

  it("marks a Vercel-only variable pullable when Vercel hands its value back", async () => {
    const { env } = make([
      { id: "e1", key: "PLAIN", targets: ["preview"], type: "plain" },
      { id: "e2", key: "ENC", targets: ["development"], type: "encrypted" },
      { id: "e3", key: "SENS", targets: ["preview"], type: "sensitive" },
      { id: "e4", key: "KEY", targets: ["development", "preview"], type: "plain" },
    ]);
    const { rows } = await env.status("/dev/weft");
    const row = (name: string, environment: string) => rows.find((r: { name: string; environment: string }) => r.name === name && r.environment === environment);
    expect(row("PLAIN", "preview")).toEqual({ name: "PLAIN", environment: "preview", inVault: false, onVercel: true, pullable: true });
    expect(row("ENC", "development")).toMatchObject({ pullable: true });
    expect(row("SENS", "preview")).not.toHaveProperty("pullable");
    // In the vault already: never pullable. A blank in the vault (missing) with a plain value on Vercel is.
    expect(row("KEY", "development")).not.toHaveProperty("pullable");
    expect(row("KEY", "preview")).toMatchObject({ pullable: true });
  });

  it("marks a vault blank pullable when Vercel has a plain value for it", async () => {
    const { env } = make([{ id: "e1", key: "TODO", targets: ["production"], type: "plain" }]);
    const { rows } = await env.status("/dev/weft");
    expect(rows.find((r: { name: string }) => r.name === "TODO")).toEqual({ name: "TODO", environment: "production", inVault: false, onVercel: true, pullable: true });
  });

  it("pulls plain and encrypted variables the vault has no value for, straight into the vault", async () => {
    const { env, vault, vercel } = make(
      [
        { id: "e1", key: "NEW_PLAIN", targets: ["development", "production"], type: "plain" },
        { id: "e2", key: "NEW_ENC", targets: ["preview"], type: "encrypted" },
        { id: "e3", key: "TODO", targets: ["production"], type: "plain" },
      ],
      { e1: "one", e2: "two", e3: "three" },
    );
    expect(await env.pull("/dev/weft")).toEqual({
      label: "aimhuge/weft",
      project: "weft",
      pulled: [
        { name: "NEW_PLAIN", environment: "development" },
        { name: "NEW_PLAIN", environment: "production" },
        { name: "NEW_ENC", environment: "preview" },
        { name: "TODO", environment: "production" },
      ],
      skipped: [],
    });
    expect(vault.setValue.mock.calls).toEqual([
      ["/dev/weft", "NEW_PLAIN", "development", "one", { source: "Vercel" }],
      ["/dev/weft", "NEW_PLAIN", "production", "one", { source: "Vercel" }],
      ["/dev/weft", "NEW_ENC", "preview", "two", { source: "Vercel" }],
      ["/dev/weft", "TODO", "production", "three", { source: "Vercel" }],
    ]);
    // One fetch per variable, not per environment.
    expect(vercel.envValue).toHaveBeenCalledTimes(3);
  });

  it("never replaces a name the vault has a value for", async () => {
    const { env, vault, vercel } = make(
      [
        { id: "e1", key: "KEY", targets: ["development", "production", "preview"], type: "plain" },
        { id: "e2", key: "KEY2", targets: ["development"], type: "plain" },
      ],
      { e1: "vercel-value", e2: "x" },
    );
    const result = await env.pull("/dev/weft");
    // KEY has vault values in development and production, so only its preview comes down.
    expect(result.pulled).toEqual([
      { name: "KEY", environment: "preview" },
      { name: "KEY2", environment: "development" },
    ]);
    expect(vault.setValue.mock.calls).toEqual([
      ["/dev/weft", "KEY", "preview", "vercel-value", { source: "Vercel" }],
      ["/dev/weft", "KEY2", "development", "x", { source: "Vercel" }],
    ]);
    expect(vercel.envValue).toHaveBeenCalledTimes(2);
  });

  it("leaves a variable alone, without asking Vercel, when every target has a vault value", async () => {
    const { env, vault, vercel } = make([{ id: "e1", key: "KEY", targets: ["development"], type: "plain" }]);
    expect(await env.pull("/dev/weft")).toMatchObject({ pulled: [], skipped: [] });
    expect(vercel.envValue).not.toHaveBeenCalled();
    expect(vault.setValue).not.toHaveBeenCalled();
  });

  it("skips sensitive variables, and ones whose value comes back empty, naming them", async () => {
    const { env, vault, vercel } = make(
      [
        { id: "e1", key: "SECRET_ONE", targets: ["production", "preview"], type: "sensitive" },
        { id: "e2", key: "OLD", targets: ["production"], type: "secret" },
        { id: "e3", key: "GONE", targets: ["preview"], type: "plain" },
        { key: "NO_ID", targets: ["preview"], type: "plain" },
        { id: "e5", key: "OK", targets: ["preview"], type: "plain" },
      ],
      { e3: null, e5: "fine" },
    );
    expect(await env.pull("/dev/weft")).toEqual({
      label: "aimhuge/weft",
      project: "weft",
      pulled: [{ name: "OK", environment: "preview" }],
      skipped: [
        { name: "SECRET_ONE", environment: "production" },
        { name: "SECRET_ONE", environment: "preview" },
        { name: "OLD", environment: "production" },
        { name: "GONE", environment: "preview" },
        { name: "NO_ID", environment: "preview" },
      ],
    });
    expect(vault.setValue.mock.calls).toEqual([
      ["/dev/weft", "OK", "preview", "fine", { source: "Vercel" }],
    ]);
    // Sensitive and untyped-id variables are never fetched.
    expect(vercel.envValue).toHaveBeenCalledTimes(2);
    expect(vercel.envValue).not.toHaveBeenCalledWith("/dev/weft", "e1");
  });

  it("skips targets that aren't development, preview or production, and names that aren't variable names", async () => {
    const { env, vault, vercel } = make(
      [
        { id: "e1", key: "STAGED", targets: ["staging"], type: "plain" },
        { id: "e2", key: "1BAD", targets: ["production"], type: "plain" },
        { id: "e3", key: "has-dash", targets: ["production"], type: "plain" },
        { id: "e4", key: "MIXED", targets: ["staging", "preview"], type: "plain" },
        { id: "e5", key: "NO_TARGETS", targets: [], type: "plain" },
      ],
      { e4: "m" },
    );
    expect(await env.pull("/dev/weft")).toMatchObject({ pulled: [{ name: "MIXED", environment: "preview" }], skipped: [] });
    expect(vault.setValue.mock.calls).toEqual([
      ["/dev/weft", "MIXED", "preview", "m", { source: "Vercel" }],
    ]);
    expect(vercel.envValue).toHaveBeenCalledTimes(1);
  });

  it("passes a team webhook through to Vercel and back", async () => {
    const { env, vercel } = make();
    expect(await env.createWebhook("team_a", "https://weft.zip/hook")).toEqual({ id: "hook_1", secret: "s" });
    expect(vercel.createWebhook).toHaveBeenCalledWith("team_a", "https://weft.zip/hook");
    expect(await env.deleteWebhook("team_a", "hook_1")).toEqual({ removed: true });
    expect(vercel.deleteWebhook).toHaveBeenCalledWith("team_a", "hook_1");
  });

  it("gives threads a status and a push route", async () => {
    const env = { status: vi.fn(() => Promise.resolve({})), push: vi.fn(() => Promise.resolve({})) };
    const routes = envRoutes(() => env);
    await routes["POST /vercel/env-status"]({ folder: "/dev/weft" });
    await routes["POST /vercel/env-push"]({ folder: "/dev/weft", name: "KEY", environment: undefined });
    expect(env.status).toHaveBeenCalledWith("/dev/weft");
    expect(env.push).toHaveBeenCalledWith("/dev/weft", "KEY", "", "");
  });

  // The push route proves which card asked, so a grant that names writes can cover the push
  // (electron/card-token.cjs, 2026-10-29).
  it("pushes with the card the request proved, not the card it names", async () => {
    const env = { status: vi.fn(() => Promise.resolve({})), push: vi.fn(() => Promise.resolve({})) };
    const routes = envRoutes(() => env, (_body, route) => (route === "/vercel/env-push" ? "proven" : ""));
    await routes["POST /vercel/env-push"]({ folder: "/dev/weft", name: "KEY", environment: "production", card: "someone-else" }, "/vercel/env-push");
    expect(env.push).toHaveBeenCalledWith("/dev/weft", "KEY", "production", "proven");
  });

  it("gives the control server a pull route and webhook routes", async () => {
    const env = { pull: vi.fn(() => Promise.resolve({})), createWebhook: vi.fn(() => Promise.resolve({})), deleteWebhook: vi.fn(() => Promise.resolve({})) };
    const routes = envRoutes(() => env);
    await routes["POST /vercel/env-pull"]({ folder: "/dev/weft" });
    await routes["POST /vercel/webhook-create"]({ teamId: "team_a", url: "https://weft.zip/hook" });
    await routes["POST /vercel/webhook-delete"]({ teamId: "team_a", id: 7 });
    expect(env.pull).toHaveBeenCalledWith("/dev/weft");
    expect(env.createWebhook).toHaveBeenCalledWith("team_a", "https://weft.zip/hook");
    expect(env.deleteWebhook).toHaveBeenCalledWith("team_a", "7");
  });
});
