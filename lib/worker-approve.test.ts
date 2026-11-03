// A worker's rule for an answer (lib/worker-approve.ts): the pairing Mac's signature, or a passkey it endorsed here,
// over the message the worker rebuilds from its own names; an unsigned Allow refused once either is pinned.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { approvalMessage, type ApprovalFields } from "./approval-sig";
import type { AnswerPayload, CloudCommandRow } from "./cloud-commands";
import type { CloudCardRow } from "./cloud-sync-types";
import { endorseMessage, type EndorsedKey, type Endorsement } from "./host-endorse";
import { createHostSigners } from "./host-signers";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { makePasskey } from "./passkey.harness";
import { PASSKEY_ORIGIN, PASSKEY_RP_ID } from "./passkey-verify";
import { sodium } from "./sodium";
import type { PendingPermission } from "./types";
import { workerApprove, WORKER_UNSIGNED } from "./worker-approve";
import { command, fakeEngine, card as makeCard } from "./worker-daemon.harness";
import { workerRules } from "./worker-card-commands";
import { cardKinds } from "./host/dispatch";
import { approvalToSign, passkeyAuth } from "./web-passkey-approval";
import { nonceBook } from "./widen-nonces";
import type { WorkerWiden } from "./worker-widen";

const NOW = 9_000_000;
const ORIGINS = [{ origin: PASSKEY_ORIGIN, rpId: PASSKEY_RP_ID }];
const pending = { id: "p-1", toolName: "Bash", title: "Bash", input: { command: "rm -rf build" } } as unknown as PendingPermission;
const card = makeCard({ pending, cwd: "/w/app" });
const answer: AnswerPayload = { cardId: "card-1", pendingId: "p-1", allow: true };
const home = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-approve-")), "home");

function setup(keys: string[], over: Partial<WorkerWiden> = {}) {
  const signers = createHostSigners(home(), ORIGINS, memoryMacs(keys));
  const w: WorkerWiden = {
    host: "w1",
    orgId: "org-1",
    signers,
    nonces: nonceBook({ load: () => ({}), save: () => {} }, () => NOW),
    projects: () => ["app"],
    root: "/w",
    projectPath: (f) => `/w/${f}`,
    nameFolder: vi.fn(),
    now: () => NOW,
    ...over,
  };
  return { w, signers, approve: workerApprove(w) };
}

// What electron/approval-sign.cjs signs for a worker card: the phone's message, its host `worker:<id>`.
async function macAuth(mac: ReturnType<typeof macSigner>, over: Partial<ApprovalFields> = {}) {
  const fields: ApprovalFields = { orgId: "org-1", macDevice: "worker:w1", cardId: "card-1", pendingId: "p-1", allow: true, issuedAt: NOW, ...over };
  return { device: "mac-1", issuedAt: fields.issuedAt, sig: mac.sign(approvalMessage(await sodium(), fields)) };
}

const row = (auth: unknown, over: Partial<CloudCommandRow> = {}) => command({ kind: "answer", payload: { ...answer, auth } as never, ...over });

describe("workerApprove: the pairing Mac's signature", () => {
  it("takes an Allow the pinned Mac signed for this worker, card and request", async () => {
    const mac = macSigner();
    const { approve } = setup([mac.key]);
    expect(await approve(row(await macAuth(mac)), answer, card)).toBeNull();
    // A grant is part of what's signed.
    const granted = await macAuth(mac, { grant: "card" });
    expect(await approve(row(granted), { ...answer, grant: "card" }, card)).toBeNull();
    expect(await approve(row(granted), answer, card)).toMatch(/isn't the pairing Mac's/);
  });

  it("rebuilds the message from its own names: the row's org and target don't move a signature", async () => {
    const mac = macSigner();
    const { approve } = setup([mac.key]);
    // Signed for another worker, or another workspace, it fails here even when the row says that worker.
    const other = await macAuth(mac, { macDevice: "worker:w2" });
    expect(await approve(row(other, { target_device: "worker:w2" }), answer, card)).toMatch(/isn't the pairing Mac's/);
    const otherOrg = await macAuth(mac, { orgId: "org-2" });
    expect(await approve(row(otherOrg, { org_id: "org-2" }), answer, card)).toMatch(/isn't the pairing Mac's/);
    // Wrong card, request or decision.
    const auth = await macAuth(mac);
    expect(await approve(row(auth), { ...answer, cardId: "card-2" }, card)).toMatch(/isn't the pairing Mac's/);
    expect(await approve(row(auth), { ...answer, pendingId: "p-2" }, card)).toMatch(/isn't the pairing Mac's/);
    expect(await approve(row(auth), { ...answer, allow: false }, card)).toMatch(/isn't the pairing Mac's/);
  });

  it("refuses another Mac's key, a stale one, and any signature without an org (fail closed)", async () => {
    const mac = macSigner();
    expect(await setup([macSigner().key]).approve(row(await macAuth(mac)), answer, card)).toMatch(/isn't the pairing Mac's/);
    expect(await setup([mac.key]).approve(row(await macAuth(mac, { issuedAt: NOW - 6 * 60_000 })), answer, card)).toMatch(/too old/);
    const noOrg = setup([mac.key], { orgId: undefined });
    expect(await noOrg.approve(row(await macAuth(mac)), answer, card)).toMatch(/isn't the pairing Mac's/);
  });
});

describe("workerApprove: unsigned answers", () => {
  it("refuses an unsigned Allow in its own words once a Mac is pinned", async () => {
    expect(await setup([macSigner().key]).approve(row(undefined), answer, card)).toBe(WORKER_UNSIGNED);
    // On the box's own clock when no test clock is given: a signature from now checks out.
    const mac = macSigner();
    const live = setup([mac.key], { now: undefined });
    expect(await live.approve(row(await macAuth(mac, { issuedAt: Date.now() })), answer, card)).toBeNull();
  });

  it("lets a Deny and a question's answers through unsigned", async () => {
    const { approve } = setup([macSigner().key]);
    expect(await approve(row(undefined), { ...answer, allow: false }, card)).toBeNull();
    const question = makeCard({ pending: { ...pending, questions: [{ question: "Which?" }] } as PendingPermission });
    expect(await approve(row(undefined), { ...answer, answers: { Which: "a" } }, question)).toBeNull();
  });

  it("lets an unsigned Allow through on a box that trusts no key (token-enrolled), and refuses when it can't count them", async () => {
    expect(await setup([]).approve(row(undefined), answer, card)).toBeNull();
    const { w } = setup([]);
    const blind = workerApprove({ ...w, signers: { verify: w.signers.verify, verifyPasskey: w.signers.verifyPasskey, endorse: w.signers.endorse } });
    expect(await blind(row(undefined), answer, card)).toBe(WORKER_UNSIGNED);
  });
});

describe("workerApprove: a passkey the Mac endorsed (sign.weft.zip's Allow)", () => {
  async function endorsedPasskey(mac: ReturnType<typeof macSigner>, signers: ReturnType<typeof createHostSigners>) {
    const pk = await makePasskey();
    const key: EndorsedKey = { device: "browser-1", credId: "Y3JlZA", publicKey: pk.publicKey };
    const e: Endorsement = { worker: "w1", passkeys: [key], generation: 1, issuedAt: NOW };
    await signers.endorse({ ...e, mac: "mac-1", sig: mac.sign(endorseMessage(e)) }, "w1", NOW);
    return pk;
  }
  // The row as worker_put_card publishes it: owner_device worker:<id>, the project's folder name.
  const cardRow = { org_id: "org-1", card_id: "card-1", owner_device: "worker:w1", folder: "app", card } as CloudCardRow;

  it("verifies what sign.weft.zip signs over the worker's published row", async () => {
    const mac = macSigner();
    const { approve, signers } = setup([mac.key], { folderOf: () => "app" });
    const pk = await endorsedPasskey(mac, signers);
    const toSign = approvalToSign(cardRow, { allow: true }, { device: "browser-1", credId: "Y3JlZA" }, NOW)!;
    const auth = passkeyAuth(toSign, await pk.sign(toSign.message));
    expect(await approve(row(auth), answer, card)).toBeNull();
    // Over another folder than the one this worker names the card by, it doesn't check out.
    const elsewhere = approvalToSign({ ...cardRow, folder: "site" }, { allow: true }, { device: "browser-1", credId: "Y3JlZA" }, NOW)!;
    expect(await approve(row(passkeyAuth(elsewhere, await pk.sign(elsewhere.message))), answer, card)).toMatch(/signed a different approval/);
  });

  it("names the card by its folder's base name when no publisher says otherwise", async () => {
    const mac = macSigner();
    const { approve, signers } = setup([mac.key]);
    const pk = await endorsedPasskey(mac, signers);
    const toSign = approvalToSign(cardRow, { allow: true }, { device: "browser-1", credId: "Y3JlZA" }, NOW)!;
    expect(await approve(row(passkeyAuth(toSign, await pk.sign(toSign.message))), answer, card)).toBeNull();
  });
});

describe("workerRules: an answer on a worker goes through the rule on every route", () => {
  function kinds(keys: string[]) {
    const eng = fakeEngine({ "card-1": card });
    const { w } = setup(keys);
    return { eng, k: cardKinds(workerRules(eng.engine, undefined, undefined, "u-1", w)) };
  }

  it("refuses an unsigned host card.permission.answer (the tile, the line) and runs a signed one", async () => {
    const mac = macSigner();
    const { eng, k } = kinds([mac.key]);
    const host = (args: Record<string, unknown>) => k.host(command({ kind: "host", payload: { verb: "card.permission.answer", args: { id: "card-1", allow: true, pendingId: "p-1", ...args } } as never }));
    await expect(host({})).rejects.toThrow(WORKER_UNSIGNED);
    expect(eng.answer).not.toHaveBeenCalled();
    await host({ auth: await macAuth(mac) });
    expect(eng.answer).toHaveBeenCalledWith("card-1", true, undefined, "p-1");
  });

  it("refuses an unsigned answer kind (the thread's Allow), and needs the request's id", async () => {
    const { eng, k } = kinds([macSigner().key]);
    await expect(k.answer(row(undefined))).rejects.toThrow(WORKER_UNSIGNED);
    await expect(k.host(command({ kind: "host", payload: { verb: "card.permission.answer", args: { id: "card-1", allow: true } } as never }))).rejects.toThrow(/empty/);
    expect(eng.answer).not.toHaveBeenCalled();
  });
});
