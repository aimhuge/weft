// The passkey heads main publishes beside its endorsements (electron/widen-endorse.cjs): byte for byte what a worker
// checks (lib/passkey-head.ts), published with every set it signs, retried when the insert fails, signed again daily,
// and the revocations from other Macs reconciled before each refresh narrows the sets.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { headMessage as tsHead, newestHead } from "../lib/passkey-head";
import { createEndorsed, HEAD_EVERY_MS, headMessage, registerWidenEndorse } from "./widen-endorse.cjs";

const safeStorage = () => ({ encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, "") });

function setup(over: { publishHead?: (worker: string, head: object) => Promise<unknown>; reconcile?: () => Promise<unknown> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-endorse-heads-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const signer = { sign: (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
  const map = new Map<string, (...args: unknown[]) => unknown>();
  const heads: { worker: string; head: Record<string, unknown> }[] = [];
  const publishHead = vi.fn(over.publishHead ?? ((worker: string, head: object) => Promise.resolve(void heads.push({ worker, head: head as Record<string, unknown> }))));
  const paired = { list: [{ id: "b1", passkey: { credId: "Y3JlZA", publicKey: "cGstMQ" } }] as { id: string; passkey?: { credId: string; publicKey: string } }[] };
  const endorsed = createEndorsed({ dir, safeStorage });
  let clock = 5_000;
  registerWidenEndorse((channel: string, fn: (...args: unknown[]) => unknown) => void map.set(channel, fn), {
    signer,
    macDevice: () => "mac-1",
    confirm: () => Promise.resolve(true),
    passkeys: () => paired.list,
    endorsed,
    now: () => clock,
    publishHead,
    ...(over.reconcile ? { reconcile: over.reconcile } : {}),
  });
  const call = (channel: string, ...args: unknown[]) => map.get(channel)?.(...args) as Promise<Record<string, unknown>[] | null>;
  return { call, heads, publishHead, paired, publicKey, endorsed, advance: (ms: number) => (clock += ms) };
}

describe("main's head message", () => {
  it("agrees with the worker's", () => {
    const h = { worker: "w", generation: 2, issuedAt: 3 };
    expect(headMessage(h)).toBe(tsHead(h));
  });
});

describe("publishing heads", () => {
  it("publishes a head for each set it signs, before handing the set back, that the worker's check takes", async () => {
    const h = setup();
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    expect(h.heads).toHaveLength(1);
    expect(h.heads[0]).toMatchObject({ worker: "w1", head: { worker: "w1", generation: e?.generation, mac: "mac-1" } });
    expect(newestHead(h.heads.map((x) => x.head), "w1", [h.publicKey])).toBe(e?.generation);
    // A revoke, no Touch ID: its head goes at once, with the newer generation.
    h.advance(1);
    const [none] = (await h.call("approval:endorse", { worker: "w1", revoke: true })) ?? [];
    expect(newestHead(h.heads.map((x) => x.head), "w1", [h.publicKey])).toBe(none?.generation);
    // Nothing new to say on a refresh the same day.
    await h.call("approval:endorse-refresh");
    expect(h.heads).toHaveLength(2);
  });

  it("publishes a narrowing's head on the refresh that signs it, and signs a fresh head once a day", async () => {
    const h = setup();
    await h.call("approval:endorse", { worker: "w1" });
    h.paired.list = [];
    h.advance(1);
    const [set] = (await h.call("approval:endorse-refresh")) as unknown as { generation: number }[];
    expect(h.heads.at(-1)?.head).toMatchObject({ generation: set?.generation });
    h.advance(HEAD_EVERY_MS);
    await h.call("approval:endorse-refresh");
    expect(h.heads).toHaveLength(3);
    expect(h.heads.at(-1)?.head).toMatchObject({ generation: set?.generation, issuedAt: 5_001 + HEAD_EVERY_MS });
  });

  it("tries a failed head again in five minutes, or at once for a newer set, and still hands the set back", async () => {
    let fail = true;
    const sent: unknown[] = [];
    const h = setup({ publishHead: (_w, head) => (fail ? Promise.reject(new Error("no table")) : Promise.resolve(void sent.push(head))) });
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    expect(e).toMatchObject({ worker: "w1" });
    await h.call("approval:endorse-refresh");
    expect(h.publishHead).toHaveBeenCalledTimes(1);
    fail = false;
    h.advance(5 * 60_000);
    await h.call("approval:endorse-refresh");
    expect(sent).toHaveLength(1);
    // A newer set after a failure goes at once.
    fail = true;
    h.advance(1);
    await h.call("approval:endorse", { worker: "w1", revoke: true });
    fail = false;
    h.advance(1);
    await h.call("approval:endorse", { worker: "w1", revoke: true });
    expect(sent).toHaveLength(2);
  });

  it("skips a record it can't read and a worker id it wouldn't sign", async () => {
    const h = setup();
    h.endorsed.set("a b", { generation: 1 });
    h.endorsed.set("w2", null);
    h.endorsed.set("w3", { generation: "x", endorsement: { generation: 1 }, confirmed: 2 });
    h.advance(HEAD_EVERY_MS);
    await h.call("approval:endorse-refresh");
    expect(h.publishHead).not.toHaveBeenCalled();
  });
});

describe("reconciling before a refresh", () => {
  it("drops what other Macs revoked first, so the same refresh narrows; a failed read doesn't stop it", async () => {
    const reconcile = vi.fn(() => Promise.reject(new Error("offline")));
    const h = setup({ reconcile });
    await h.call("approval:endorse", { worker: "w1" });
    expect(await h.call("approval:endorse-refresh")).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
