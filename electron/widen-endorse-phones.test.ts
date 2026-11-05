// A paired phone approving on a worker (H10): main endorses this Mac's paired phones' sign keys to a worker in the same
// signed set as its passkeys (`weft-endorse-v3`, electron/widen-endorse.cjs), the worker pins them (lib/host-signers.ts),
// and a phone's Face ID Allow, signed over the worker's own names, checks out there (lib/worker-approve.ts). A set with
// no phones stays v2 byte for byte, so a worker from before phones takes it as before.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { approvalMessage, signApproval } from "../lib/approval-sig";
import type { CloudCommandRow } from "../lib/cloud-commands";
import { endorseMessage as tsEndorse, readEndorsement } from "../lib/host-endorse";
import { createHostSigners, PHONE_SIG } from "../lib/host-signers";
import { sodium } from "../lib/sodium";
import type { Card } from "../lib/types";
import { nonceBook } from "../lib/widen-nonces";
import { workerApprove } from "../lib/worker-approve";
import { createEndorsed, endorseMessage, endorsePrompt, registerWidenEndorse } from "./widen-endorse.cjs";

const safeStorage = () => ({ encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, "") });

async function phoneKeys() {
  const s = await sodium();
  const pair = s.crypto_sign_keypair();
  const b64 = (v: Uint8Array) => s.to_base64(v, s.base64_variants.ORIGINAL);
  return { s, signKey: b64(pair.publicKey), privateKey: b64(pair.privateKey) };
}

type Device = { id: string; kind?: string; signKey?: string; passkey?: { credId: string; publicKey: string } };

function setup(devices: Device[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-endorse-phones-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  const macKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const signer = { sign: (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
  const map = new Map<string, (...args: unknown[]) => unknown>();
  const confirm = vi.fn(() => Promise.resolve(true));
  const paired = { list: devices };
  let clock = 5_000;
  registerWidenEndorse((channel: string, fn: (...args: unknown[]) => unknown) => void map.set(channel, fn), {
    signer,
    macDevice: () => "mac-1",
    confirm,
    passkeys: () => paired.list,
    endorsed: createEndorsed({ dir, safeStorage }),
    workerName: () => "m1mini",
    now: () => clock,
  });
  const call = (channel: string, ...args: unknown[]) => map.get(channel)?.(...args) as Promise<Record<string, unknown>[] | null>;
  const home = path.join(dir, "worker");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([macKey]));
  return { call, confirm, paired, home, tick: () => (clock += 1) };
}

const pending = { id: "p-1", toolName: "Bash", input: { command: "make test" } };
const card = { id: "card-9", cwd: "/w/app", pending } as unknown as Card;
const answer = { cardId: "card-9", pendingId: "p-1", allow: true };

describe("main's endorsement message with phones", () => {
  it("is v3 with the phones in device order, agreeing with the worker's, and v2 without them", () => {
    const passkeys = [{ device: "b1", credId: "c", publicKey: "k" }];
    const phones = [{ device: "ph2", signKey: "a2V5Mg==" }, { device: "ph1", signKey: "a2V5MQ==" }];
    const e = { worker: "w", passkeys, phones, generation: 2, issuedAt: 3 };
    expect(endorseMessage(e)).toBe(tsEndorse(e));
    expect(endorseMessage(e)).toContain('"v":"weft-endorse-v3"');
    expect(endorseMessage({ ...e, phones: [...phones].reverse() })).toBe(endorseMessage(e));
    const parsed = JSON.parse(endorseMessage(e)) as { phones: { device: string }[] };
    expect(parsed.phones.map((p) => p.device)).toEqual(["ph1", "ph2"]);
    // No phones, or an empty list: the v2 bytes an older worker checks.
    const v2 = endorseMessage({ worker: "w", passkeys, generation: 2, issuedAt: 3 });
    expect(v2).toContain('"v":"weft-endorse-v2"');
    expect(endorseMessage({ ...e, phones: [] })).toBe(v2);
    expect(tsEndorse({ ...e, phones: [] })).toBe(v2);
  });

  it("asks Touch ID naming what each kind may approve", () => {
    expect(endorsePrompt(1, 0, "m1mini (w1)")).toBe('let your paired passkey approve folder, agent and "!" changes and Allows on the worker m1mini (w1)');
    expect(endorsePrompt(0, 2, "w1")).toBe("let your 2 paired phones approve Allows on the worker w1");
    expect(endorsePrompt(2, 1, "w1")).toBe('let your 2 paired passkeys approve folder, agent and "!" changes and Allows, and your paired phone approve Allows on the worker w1');
  });
});

describe("a phone approving on a worker", () => {
  it("is endorsed after Touch ID, and its signed Allow over the worker's names checks out there", async () => {
    const { s, signKey, privateKey } = await phoneKeys();
    const h = setup([{ id: "ph1", kind: "phone", signKey }, { id: "br1", kind: "browser", signKey: "aWdub3JlZA==" }]);
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    expect(h.confirm).toHaveBeenCalledWith("let your paired phone approve Allows on the worker m1mini (w1)");
    expect(e).toMatchObject({ worker: "w1", passkeys: [], phones: [{ device: "ph1", signKey }] });
    expect(readEndorsement(e)?.phones).toEqual([{ device: "ph1", signKey }]);

    const signers = createHostSigners(h.home, []);
    expect(await signers.endorse(e, "w1", 5_000)).toBe(5_000);
    expect(signers.phones()).toEqual([{ device: "ph1", signKey, by: "mac-1" }]);
    expect(signers.approvers()).toBe(2);

    const now = 9_000;
    const approve = workerApprove({ host: "w1", orgId: "org-1", signers, nonces: nonceBook({ load: () => ({}), save: () => {} }, () => now), projects: () => [], root: "/w", projectPath: (f) => f, nameFolder: () => {}, now: () => now });
    const sig = (over: Record<string, unknown> = {}) =>
      signApproval(s, approvalMessage(s, { orgId: "org-1", macDevice: "worker:w1", ...answer, issuedAt: now, ...over }), privateKey);
    const row = (auth: unknown) => ({ org_id: "org-x", target_device: "worker:wx", payload: { ...answer, auth } }) as unknown as CloudCommandRow;
    expect(await approve(row({ device: "ph1", issuedAt: now, sig: sig() }), answer, card)).toBeNull();
    // Another request, another worker or workspace, or a key the worker didn't pin doesn't check out.
    expect(await approve(row({ device: "ph1", issuedAt: now, sig: sig({ pendingId: "p-2" }) }), answer, card)).toBe(PHONE_SIG);
    expect(await approve(row({ device: "ph1", issuedAt: now, sig: sig({ macDevice: "worker:w2" }) }), answer, card)).toBe(PHONE_SIG);
    expect(await approve(row({ device: "ph1", issuedAt: now, sig: sig({ orgId: "org-2" }) }), answer, card)).toBe(PHONE_SIG);
    expect(await approve(row({ device: "ph9", issuedAt: now, sig: sig() }), answer, card)).toMatch(/isn't the pairing Mac's/);
    // A phone signs no widening: signers.verify is the pairing Mac's alone.
    expect((await signers.verify({ device: "ph1", message: "m", sig: sig() })).ok).toBe(false);
  });

  it("drops out of the worker's set when it's unpaired here: a narrowing, signed without Touch ID", async () => {
    const { s, signKey, privateKey } = await phoneKeys();
    const h = setup([{ id: "ph1", kind: "phone", signKey }, { id: "b1", passkey: { credId: "Y3JlZA", publicKey: "cGstMQ" } }]);
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    const signers = createHostSigners(h.home, []);
    await signers.endorse(e, "w1", 5_000);
    h.paired.list = h.paired.list.filter((d) => d.id !== "ph1");
    h.tick();
    h.confirm.mockClear();
    const [narrowed] = (await h.call("approval:endorse-refresh")) as unknown as { endorsements: Record<string, unknown>[] }[];
    expect(h.confirm).not.toHaveBeenCalled();
    const next = narrowed!.endorsements[0]!;
    // Back to v2: no phones left, so the set reads as it did before phones.
    expect(next).not.toHaveProperty("phones");
    expect(await signers.endorse(next, "w1", 5_001)).toBe(5_001);
    expect(signers.phones()).toEqual([]);
    const message = approvalMessage(s, { orgId: "org-1", macDevice: "worker:w1", ...answer, issuedAt: 1 });
    expect((await signers.verifyAnswer({ device: "ph1", message, sig: signApproval(s, message, privateKey) })).ok).toBe(false);
  });

  it("keeps a set with phones refused by a worker that reads it as v2, so it's sent again rather than half taken", async () => {
    const { signKey } = await phoneKeys();
    const h = setup([{ id: "ph1", kind: "phone", signKey }]);
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    // An older worker drops the phones it doesn't know and checks the v2 bytes: the signature fails there.
    const stripped = Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([k]) => k !== "phones"));
    const signers = createHostSigners(h.home, []);
    await expect(signers.endorse(stripped, "w1", 5_000)).rejects.toThrow(/isn't the pairing Mac's/);
    expect(signers.phones()).toEqual([]);
  });
});
