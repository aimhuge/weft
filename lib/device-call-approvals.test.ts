// The Mac's half of a worker's tunnel and relay: every arg is the worker's word and re-checked, nothing happens without
// Touch ID, and what's written is written as the owner, for that worker only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveTunnel, cleanWord, createWorkerRelay, runApproval, type ApprovalDeps, type ApprovalRow } from "./device-call-approvals";

vi.mock("./webhook-forward", () => ({ relayUrl: (id: string) => `https://weft.zip/api/hooks/${id}` }));

type Result = { data?: unknown; error?: { message: string } | null };
interface Op {
  table: string;
  op: string;
  value?: unknown;
}

// A Supabase client whose every chain resolves to what `answer` gives for its table and first operation.
function fakeClient(answer: (op: Op) => Result) {
  const ops: Op[] = [];
  const from = (table: string) => {
    let current: Op | null = null;
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "insert", "update", "eq", "not", "limit", "maybeSingle", "single"]) {
      chain[name] = (value?: unknown) => {
        if (!current && ["select", "insert", "update"].includes(name)) {
          current = { table, op: name, value };
          ops.push(current);
        }
        return chain;
      };
    }
    chain.then = (resolve: (r: Result) => unknown) => resolve({ data: null, error: null, ...answer(current!) });
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient, ops };
}

const TUNNEL = "11111111-1111-4111-8111-111111111111";
const row = (tool: string, args: unknown): ApprovalRow => ({ id: "call-1", worker_id: "w1", card_id: "c1", tool, args });
let shellCalls: { path: string; body: Record<string, unknown> }[];
let shellAnswer: Record<string, unknown>;
const deps: ApprovalDeps = {
  shell: (p: string, body?: Record<string, unknown>) => {
    shellCalls.push({ path: p, body: body ?? {} });
    return Promise.resolve(shellAnswer);
  },
  repos: () => [{ path: "/Users/me/dev/weft", github: "aimhuge/weft" }, { path: "/x" }],
  now: () => 1_000,
};

beforeEach(() => {
  shellCalls = [];
  shellAnswer = { approved: true };
});

describe("approveTunnel", () => {
  const ok = (over: Record<string, unknown> = {}) => row("tunnel_open", { tunnel: TUNNEL, target: "http://localhost:3000", hours: 2, folder: "weft", ...over });
  const named = (op: Op): Result => (op.table === "cloud_workers" ? { data: { name: "m1mini" } } : {});

  it("asks Touch ID naming the worker, then makes the row for that worker and stamps the approval", async () => {
    const { client, ops } = fakeClient(named);
    expect(await approveTunnel(client, ok(), deps)).toEqual({ approved: true, until: 1_000 + 2 * 3_600_000 });
    expect(shellCalls).toEqual([{ path: "/tunnels/approve", body: { folder: "weft on m1mini", target: "http://localhost:3000", hours: 2 } }]);
    expect(ops.filter((o) => o.op !== "select")).toEqual([
      { table: "tunnels", op: "insert", value: { id: TUNNEL, name: "m1mini localhost:3000", worker_id: "w1" } },
      { table: "tunnels", op: "update", value: { approved_target: "http://localhost:3000", approved_until: new Date(1_000 + 2 * 3_600_000).toISOString() } },
    ]);
  });

  it("reuses this worker's row, and refuses a row that's another host's", async () => {
    const mine = fakeClient((op) => (op.table === "tunnels" && op.op === "select" ? { data: { worker_id: "w1" } } : {}));
    await approveTunnel(mine.client, ok({ hours: "lots" }), deps);
    expect(mine.ops.some((o) => o.op === "insert")).toBe(false);
    expect(shellCalls[0]?.body).toMatchObject({ folder: "weft on your worker", hours: 4 });
    const theirs = fakeClient((op) => (op.table === "tunnels" && op.op === "select" ? { data: { worker_id: null } } : {}));
    await expect(approveTunnel(theirs.client, ok(), deps)).rejects.toThrow("another host");
  });

  it("writes nothing when the user says no", async () => {
    shellAnswer = {};
    const { client, ops } = fakeClient(named);
    expect(await approveTunnel(client, ok({ folder: "" }), deps)).toEqual({ approved: false });
    expect(shellCalls[0]?.body.folder).toBe("a project on m1mini");
    expect(ops.map((o) => o.table)).toEqual(["cloud_workers"]);
  });

  it("refuses an id or a target it can't trust, before asking anyone", async () => {
    const { client } = fakeClient(named);
    await expect(approveTunnel(client, row("tunnel_open", null), deps)).rejects.toThrow("no id");
    await expect(approveTunnel(client, ok({ target: "http://evil.example:3000" }), deps)).rejects.toThrow("own localhost");
    await expect(approveTunnel(client, ok({ target: "nope" }), deps)).rejects.toThrow("own localhost");
    expect(shellCalls).toEqual([]);
  });

  it("says what Supabase said", async () => {
    const read = fakeClient((op) => (op.table === "tunnels" ? { error: { message: "read" } } : {}));
    await expect(approveTunnel(read.client, ok(), deps)).rejects.toThrow("read");
    const insert = fakeClient((op) => (op.op === "insert" ? { error: { message: "insert" } } : {}));
    await expect(approveTunnel(insert.client, ok(), deps)).rejects.toThrow("insert");
    const update = fakeClient((op) => (op.op === "update" ? { error: { message: "update" } } : {}));
    await expect(approveTunnel(update.client, ok(), deps)).rejects.toThrow("update");
  });
});

describe("createWorkerRelay", () => {
  const args = { name: "stripe", provider: "stripe", secret: "STRIPE_WEBHOOK_SECRET", repo: "AimHuge/Weft", target: "http://localhost:3000/api/stripe/webhook" };
  const sealed = { secret_ciphertext: "c", secret_nonce: "n", secret_key_id: "k" };

  it("seals the secret from the repo's vault, and inserts the relay for the worker, through its open tunnel", async () => {
    shellAnswer = sealed;
    const { client, ops } = fakeClient((op) => (op.table === "tunnels" ? { data: [{ id: TUNNEL }] } : op.op === "insert" ? { data: { id: "r1" } } : {}));
    expect(await createWorkerRelay(client, row("relay_create", args), deps)).toEqual({ relayId: "r1", url: "https://weft.zip/api/hooks/r1" });
    expect(shellCalls).toEqual([{ path: "/webhooks/relay-seal", body: { folder: "/Users/me/dev/weft", name: "STRIPE_WEBHOOK_SECRET", environment: "development", provider: "stripe" } }]);
    expect(ops.find((o) => o.op === "insert")?.value).toEqual({
      name: "stripe",
      provider: "stripe",
      ...sealed,
      worker_id: "w1",
      worker_origin: "http://localhost:3000",
      tunnel_path: "/api/stripe/webhook",
      tunnel_id: TUNNEL,
    });
  });

  it("names the provider when the name cleans away, and waits for a tunnel when none is open", async () => {
    shellAnswer = sealed;
    const { client, ops } = fakeClient((op) => (op.op === "insert" ? { data: { id: "r2" } } : {}));
    await createWorkerRelay(client, row("relay_create", { ...args, name: "<<>>" }), deps);
    expect(ops.find((o) => o.op === "insert")?.value).toMatchObject({ name: "stripe", tunnel_id: null });
  });

  it("answers denied or missing, and inserts nothing", async () => {
    const { client, ops } = fakeClient(() => ({}));
    shellAnswer = { denied: true };
    expect(await createWorkerRelay(client, row("relay_create", args), deps)).toEqual({ denied: true });
    shellAnswer = { missing: true };
    expect(await createWorkerRelay(client, row("relay_create", args), deps)).toEqual({ missing: true });
    shellAnswer = { secret_ciphertext: "c" };
    expect(await createWorkerRelay(client, row("relay_create", args), deps)).toEqual({ missing: true });
    expect(ops).toEqual([]);
  });

  it("refuses what it can't check, and a repo this Mac has no clone of", async () => {
    const { client } = fakeClient(() => ({}));
    const refuse = (over: Record<string, unknown>) => createWorkerRelay(client, row("relay_create", { ...args, ...over }), deps);
    await expect(refuse({ provider: "paypal" })).rejects.toThrow("Unknown provider");
    await expect(refuse({ secret: "1bad name" })).rejects.toThrow("vault name");
    await expect(refuse({ repo: "not a repo" })).rejects.toThrow("GitHub repo");
    await expect(refuse({ target: "https://example.com/x" })).rejects.toThrow("own localhost");
    await expect(refuse({ repo: "me/other" })).rejects.toThrow("no clone of me/other");
    await expect(createWorkerRelay(client, row("relay_create", []), deps)).rejects.toThrow("Unknown provider");
    expect(shellCalls).toEqual([]);
  });

  it("says when the row wasn't saved", async () => {
    shellAnswer = sealed;
    const failed = fakeClient((op) => (op.op === "insert" ? { error: { message: "rls" } } : {}));
    await expect(createWorkerRelay(failed.client, row("relay_create", args), deps)).rejects.toThrow("rls");
    const empty = fakeClient(() => ({}));
    await expect(createWorkerRelay(empty.client, row("relay_create", args), deps)).rejects.toThrow("wasn't saved");
  });
});

describe("runApproval", () => {
  it("sends each tool to its handler", async () => {
    const { client } = fakeClient(() => ({}));
    shellAnswer = {};
    expect(await runApproval(client, row("tunnel_open", { tunnel: TUNNEL, target: "http://127.0.0.1:5173" }), deps)).toEqual({ approved: false });
    shellAnswer = { denied: true };
    expect(await runApproval(client, row("relay_create", { provider: "github", secret: "S", repo: "aimhuge/weft", target: "http://localhost:3000/h" }), deps)).toEqual({ denied: true });
  });

  it("cleans a worker's word for a prompt", () => {
    expect(cleanWord("m1mini; rm -rf / `x` ‮")).toBe("m1mini rm -rf / x ");
    expect(cleanWord(undefined)).toBe("");
    expect(cleanWord("a".repeat(100))).toHaveLength(60);
  });
});
