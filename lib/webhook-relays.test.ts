import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Several webhooks' relays under one Touch ID per folder. The account's Supabase client is a fake
// (webhook-forward.harness), the registry (lib/webhooks.ts) is real in a temp WEFT_DATA, and shell() stands in for main.

const fake = await vi.hoisted(async () => {
  const f = (await import("./webhook-forward.harness")).fakeAccount();
  const dir = `${process.env.TMPDIR ?? "/tmp"}/weft-webhook-relays-${process.pid}`;
  process.env.WEFT_DATA = dir;
  return { ...f, dir };
});
vi.mock("./account", () => ({ accountClient: () => fake.client }));
vi.mock("./github-hooks", () => ({ HOOK_URL: "https://relay.example/api/github/webhook" }));

const trio = (n: string) => ({ secret_ciphertext: `c-${n}`, secret_nonce: `n-${n}`, secret_key_id: "v1" });
const main = vi.hoisted(() => ({
  filled: ["STRIPE_WEBHOOK_SECRET", "GH_SECRET", "OTHER_SECRET"],
  answer: null as null | Record<string, unknown>,
}));
vi.mock("./browser-tools", () => ({
  shell: vi.fn((route: string, body: { folder: string; hooks?: { name: string }[] }) => {
    if (route === "/secrets/list")
      return Promise.resolve({ secrets: [...main.filled.map((name) => ({ name, environment: "development", missing: false })), { name: "BLANK_SECRET", environment: "development", missing: true }] });
    if (route === "/webhooks/relay-seal-many") return Promise.resolve(main.answer ?? { sealed: Object.fromEntries(body.hooks!.map((h) => [h.name, trio(h.name)])) });
    return Promise.reject(new Error(`Unexpected shell call: ${route}`));
  }),
}));

const { createRelays } = await import("./webhook-relays");
const reg = await import("./webhooks");
const { shell } = await import("./browser-tools");
const seals = () => vi.mocked(shell).mock.calls.filter(([route]) => route === "/webhooks/relay-seal-many");

beforeEach(() => {
  fs.rmSync(fake.dir, { recursive: true, force: true });
  Object.assign(fake.state, { uid: "u1", relays: [], deliveries: [], error: null, nextRelay: 1, channels: [], throwClient: false });
  delete (globalThis as Record<string, unknown>).__weftWebhookRelay;
  main.answer = null;
  vi.mocked(shell).mockClear();
});

const add = (folder: string, name: string, secret?: string) => reg.addWebhook({ folder, name, target: "/hook", secret }).hook.id;

describe("createRelays", () => {
  it("seals every secret of a folder under one approval and gives each webhook its URL", async () => {
    const stripe = add("/a", "stripe", "STRIPE_WEBHOOK_SECRET");
    const github = add("/a", "github", "GH_SECRET");
    const other = add("/b", "vercel", "OTHER_SECRET");
    const results = await createRelays([stripe, github, other]);

    expect(seals()).toHaveLength(2);
    expect(seals()[0]![1]).toEqual({ folder: "/a", environment: "development", hooks: [{ name: "STRIPE_WEBHOOK_SECRET", provider: "stripe" }, { name: "GH_SECRET", provider: "github" }] });
    expect(seals()[1]![1]).toMatchObject({ folder: "/b", hooks: [{ name: "OTHER_SECRET", provider: "vercel" }] });
    expect(fake.state.relays.map((r) => [r.name, r.provider, r.secret_ciphertext])).toEqual([
      ["stripe", "stripe", "c-STRIPE_WEBHOOK_SECRET"],
      ["github", "github", "c-GH_SECRET"],
      ["vercel", "vercel", "c-OTHER_SECRET"],
    ]);
    expect(results.map((r) => r.hook?.url)).toEqual(fake.state.relays.map((row) => `https://relay.example/api/hooks/${String(row.id)}`));
    expect(reg.getWebhook(github)?.relayId).toBe(String(fake.state.relays[1]!.id));
    expect(fake.state.channels).toEqual(["webhook-deliveries-u1"]);
  });

  it("reports each webhook that can't get a relay, and still relays the rest", async () => {
    const stripe = add("/a", "stripe", "STRIPE_WEBHOOK_SECRET");
    const blank = add("/a", "github", "BLANK_SECRET");
    const noSecret = add("/a", "svix");
    const adHoc = add("/a", "team-chat", "GH_SECRET");
    const already = add("/a", "vercel", "OTHER_SECRET");
    reg.setRelay(already, { relayId: "r9", url: "https://relay.example/api/hooks/r9" });

    const results = await createRelays([stripe, blank, noSecret, adHoc, "gone", already]);
    expect(results.map((r) => r.error ?? "ok")).toEqual([
      "ok",
      "BLANK_SECRET has no value in the vault yet — add it in 🔐, then call relay again.",
      expect.stringMatching(/signing secret/),
      expect.stringMatching(/knows the provider/),
      "That webhook is gone.",
      "ok",
    ]);
    expect(results[5]!.hook?.relayId).toBe("r9");
    // Only the one that could be sealed went to main.
    expect(seals()[0]![1]).toMatchObject({ hooks: [{ name: "STRIPE_WEBHOOK_SECRET", provider: "stripe" }] });
  });

  it("makes no relay for a denial, a secret main couldn't seal, or a failed insert", async () => {
    const stripe = add("/a", "stripe", "STRIPE_WEBHOOK_SECRET");
    const github = add("/a", "github", "GH_SECRET");
    main.answer = { denied: true };
    expect((await createRelays([stripe, github])).map((r) => r.error)).toEqual([
      "Weft didn't get your Touch ID, so no relay was created.",
      "Weft didn't get your Touch ID, so no relay was created.",
    ]);
    main.answer = { sealed: { STRIPE_WEBHOOK_SECRET: trio("S") } };
    expect((await createRelays([stripe, github])).map((r) => r.error ?? "ok")).toEqual(["ok", "GH_SECRET has no value in the vault yet — add it in 🔐, then call relay again."]);
    main.answer = null;
    fake.state.error = { message: "offline" };
    expect((await createRelays([github])).map((r) => r.error)).toEqual(["offline"]);
    expect(reg.getWebhook(github)?.relayId).toBeUndefined();
  });

  it("asks nothing when no webhook needs sealing, and needs a Weft sign-in", async () => {
    const blank = add("/a", "github", "BLANK_SECRET");
    expect((await createRelays([blank]))[0]!.error).toMatch(/no value/);
    expect(seals()).toHaveLength(0);
    fake.state.uid = null;
    await expect(createRelays([blank])).rejects.toThrow(/Sign in to your Weft account/);
  });
});
