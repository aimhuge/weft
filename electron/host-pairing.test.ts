// Adding a worker by pairing it, main's half (electron/host-pairing.cjs), with the box's half made by the TypeScript
// the worker runs (lib/host-pairing.ts) and the SQL functions faked: open, claim, check, Touch ID, confirm.
import { describe, expect, it, vi } from "vitest";
import { keyHash, makeHostClaim, newSignKeys, newWorkerKey, parsePairCode } from "../lib/host-pairing";
import { createHostPairing, TTL_MS } from "./host-pairing.cjs";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PID = "11111111-2222-4333-8444-555555555555";

type Row = Record<string, unknown>;

interface DbOptions {
  openError?: { message: string } | null;
  confirmError?: { message: string } | null;
  owned?: string | null;
  updateError?: { message: string } | null;
}

function fakeDb({ openError = null, confirmError = null, owned = ORG, updateError = null }: DbOptions = {}) {
  const rows = new Map<string, Row>();
  const rpcs: { fn: string; args: Row }[] = [];
  const updates: Row[] = [];
  const db = {
    rpc: (fn: string, args: Row) => {
      rpcs.push({ fn, args });
      if (fn === "worker_pair_open") {
        if (openError) return Promise.resolve({ data: null, error: openError });
        rows.set(PID, { id: PID, status: "open", purpose: "worker", org_id: args.p_org });
        return Promise.resolve({ data: PID, error: null });
      }
      if (confirmError) return Promise.resolve({ data: null, error: confirmError });
      return Promise.resolve({ data: "worker-1", error: null });
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let patch: Row | null = null;
      Object.assign(q, {
        select: () => q,
        update: (p: Row) => ((patch = p), q),
        eq: (col: string, val: unknown) => {
          if (patch && col === "id") {
            if (updateError) return Promise.resolve({ data: null, error: updateError });
            updates.push({ id: val, ...patch });
            Object.assign(rows.get(String(val)) ?? {}, patch);
            return Promise.resolve({ data: null, error: null });
          }
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: () => Promise.resolve({ data: table === "org_memberships" && owned ? { org_id: owned } : null, error: null }),
        single: () => Promise.resolve({ data: rows.get(PID), error: null }),
      });
      return q;
    },
  };
  return { db, rows, rpcs, updates };
}

const pinWorker = vi.fn();
function setup({ confirm = true, db = fakeDb() } = {}) {
  pinWorker.mockClear();
  const clock = { t: 1_000 };
  const ask = vi.fn(() => Promise.resolve(confirm));
  const hosts = createHostPairing({ db: () => db.db, userId: () => "u1", macDevice: () => "mac-id", myDevice: () => Promise.resolve({ publicKey: "mac-key" }), confirm: ask, now: () => clock.t, pinWorker });
  return { hosts, ask, clock, ...db };
}

// The box's half, as `weft-worker enrol` does it, written into the row the way worker_pair_claim does.
function claimAs(code: string, rows: Map<string, Row>, over: Row = {}, arch = "x64") {
  const parsed = parsePairCode(code)!;
  const sign = newSignKeys();
  const body = { name: "m1mini", platform: "linux", arch, box_key: "Ym94", sign_key: sign.publicKey, key_hash: keyHash(newWorkerKey()) };
  Object.assign(rows.get(parsed.id)!, { ...makeHostClaim(parsed, body, sign), kind: "worker", status: "claimed", ...over });
  return body;
}

describe("adding a worker by pairing", () => {
  it("opens a code for your workspace whose secret never reaches the server", async () => {
    const { hosts, rpcs } = setup();
    const code = await hosts.start("");
    expect(rpcs[0]).toEqual({ fn: "worker_pair_open", args: { p_org: ORG, p_mac_device: "mac-id", p_mac_key: "mac-key" } });
    expect(code.command).toBe(`curl -fsSL https://weft.zip/worker.sh | sh -s -- ${code.code}`);
    expect(parsePairCode(code.code)).toMatchObject({ id: PID, orgId: ORG });
    expect(JSON.stringify(rpcs)).not.toContain(parsePairCode(code.code)!.secret);
    expect(code.expiresAt).toBe(1_000 + TTL_MS);
  });

  it("puts this Mac's approval key in the code, for the box to trust (and only then)", async () => {
    const macKey = Buffer.alloc(32, 9).toString("base64");
    const db = fakeDb();
    const hosts = createHostPairing({ db: () => db.db, userId: () => "u1", macDevice: () => "mac-id", myDevice: () => Promise.resolve({ publicKey: "mac-key" }), confirm: () => Promise.resolve(true), macSignKey: () => Promise.resolve(macKey) });
    const { code } = await hosts.start(ORG);
    expect(parsePairCode(code)).toMatchObject({ id: PID, orgId: ORG, macKey });
  });

  it("takes the worker back when its keys can't be pinned, rather than leave it unpinned", async () => {
    const { hosts, rows, rpcs } = setup();
    pinWorker.mockImplementationOnce(() => {
      throw new Error("keychain locked");
    });
    const { code, id } = await hosts.start(ORG);
    claimAs(code, rows);
    expect(await hosts.check(id)).toEqual({ status: "failed", error: "The worker's keys couldn't be pinned on this Mac, so it wasn't added: keychain locked" });
    expect(rpcs.at(-1)).toEqual({ fn: "device_revoke", args: { p_id: "worker-1" } });
  });

  it("checks the claim, asks Touch ID with the check code, and confirms the keys it checked", async () => {
    const { hosts, rows, rpcs, ask } = setup();
    const { code, id } = await hosts.start(ORG);
    expect(await hosts.check(id)).toEqual({ status: "open" });
    const body = claimAs(code, rows);
    const done = await hosts.check(id);
    expect(done).toMatchObject({ status: "paired", worker: { id: "worker-1", name: "m1mini", platform: "linux" } });
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/^check the box shows the code [0-9A-F]{4}-[0-9A-F]{4}, then add the worker m1mini to your workspace$/));
    expect(rpcs[1]).toEqual({ fn: "worker_pair_confirm", args: { p_pairing: id, p_key_hash: body.key_hash, p_box_key: "Ym94", p_sign_key: body.sign_key } });
    // The keys main checked are pinned for secret runs under the same Touch ID (electron/worker-pins.cjs).
    expect(pinWorker).toHaveBeenLastCalledWith("worker-1", { name: "m1mini", publicKey: "Ym94", signKey: body.sign_key });
    expect(await hosts.check(id)).toEqual({ status: "expired" });
  });

  it("refuses a claim made without the code, and cancels it", async () => {
    const { hosts, rows, rpcs, updates, ask } = setup();
    const { code, id } = await hosts.start(ORG);
    claimAs(code, rows, { box_key: "c3dhcHBlZA==" });
    expect(await hosts.check(id)).toEqual({ status: "failed", error: "The claim wasn't made with this code." });
    expect(ask).not.toHaveBeenCalled();
    expect(rpcs.map((r) => r.fn)).toEqual(["worker_pair_open"]);
    expect(updates).toContainEqual({ id, status: "cancelled" });
    expect(pinWorker).not.toHaveBeenCalled();
  });

  it("cancels when you say no at Touch ID", async () => {
    const { hosts, rows, rpcs, updates } = setup({ confirm: false });
    const { code, id } = await hosts.start(ORG);
    claimAs(code, rows);
    expect(await hosts.check(id)).toEqual({ status: "cancelled" });
    expect(rpcs.map((r) => r.fn)).toEqual(["worker_pair_open"]);
    expect(updates).toContainEqual({ id, status: "cancelled" });
  });

  it("treats a row that isn't a worker's claim as cancelled", async () => {
    const { hosts, rows } = setup();
    const { id } = await hosts.start(ORG);
    rows.get(id)!.status = "cancelled";
    expect(await hosts.check(id)).toEqual({ status: "cancelled" });
    const again = await hosts.start(ORG);
    Object.assign(rows.get(again.id)!, { status: "claimed", purpose: "device" });
    expect(await hosts.check(again.id)).toEqual({ status: "cancelled" });
  });

  it("expires the code after an hour", async () => {
    const { hosts, clock, updates } = setup();
    const { id } = await hosts.start(ORG);
    clock.t += TTL_MS + 1;
    expect(await hosts.check(id)).toEqual({ status: "expired" });
    expect(updates).toContainEqual({ id, status: "cancelled" });
  });

  it("takes a claim with no arch", async () => {
    const { hosts, rows } = setup();
    const { code, id } = await hosts.start(ORG);
    claimAs(code, rows, { arch: null }, "");
    expect((await hosts.check(id)).status).toBe("paired");
  });

  it("still expires or cancels when the server can't be told", async () => {
    const { hosts, clock } = setup({ db: fakeDb({ updateError: { message: "offline" } }) });
    const first = await hosts.start(ORG);
    clock.t += TTL_MS + 1;
    expect(await hosts.check(first.id)).toEqual({ status: "expired" });
    const second = await hosts.start(ORG);
    await expect(hosts.cancel(second.id)).resolves.toBeUndefined();
  });

  it("cancels an open code once", async () => {
    const { hosts, updates } = setup();
    const { id } = await hosts.start(ORG);
    await hosts.cancel(id);
    await hosts.cancel(id);
    expect(updates.filter((u) => u.status === "cancelled")).toHaveLength(1);
    expect(await hosts.check(id)).toEqual({ status: "expired" });
  });

  it("says why it couldn't open a code or confirm a worker", async () => {
    await expect(setup({ db: fakeDb({ owned: null }) }).hosts.start("")).rejects.toThrow("Open the web board once");
    await expect(setup({ db: fakeDb({ openError: { message: "not a member" } }) }).hosts.start(ORG)).rejects.toThrow("The pairing code couldn't be made: not a member");
    const { hosts, rows } = setup({ db: fakeDb({ confirmError: { message: "the claim changed after it was checked" } }) });
    const { code, id } = await hosts.start(ORG);
    claimAs(code, rows);
    await expect(hosts.check(id)).rejects.toThrow("The worker couldn't be added: the claim changed after it was checked");
  });
});
