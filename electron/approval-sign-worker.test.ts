// The desktop's Allow on a worker card (electron/approval-sign.cjs): main reads the worker card's row itself, words
// Touch ID from it, and signs over the worker's own names, so the worker's check (lib/worker-approve.ts) verifies it
// against the Mac key it pinned, and nothing the board window says moves the signature.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "../lib/cloud-commands";
import { createHostSigners } from "../lib/host-signers";
import { memoryMacs } from "../lib/mac-signer.harness";
import type { Card } from "../lib/types";
import { nonceBook } from "../lib/widen-nonces";
import { workerApprove } from "../lib/worker-approve";
import { findRequest, readSignRequest, serverWorkerAsk, signPrompt } from "./approval-sign.cjs";
import { fakeDb, fakeSafeStorage } from "./pairing.harness";
import { setupPairing } from "./pairing-ipc.cjs";
import vaultCrypto from "./vault-crypto.cjs";

beforeAll(async () => {
  await vaultCrypto.ready();
});
afterEach(() => vi.unstubAllGlobals());

const pending = { id: "p-1", toolName: "Bash", input: { command: "rm -rf build" } };
const ask = { orgId: "org-1", device: "worker:w1", workerId: "w1", card: { id: "card-9", title: "Clean up", pending } };
const workerAsk = (over: Record<string, unknown> = {}) => vi.fn(() => Promise.resolve({ ...ask, ...over }));

describe("readSignRequest", () => {
  it("takes a request without a workspace: a worker card's is main's own read", () => {
    expect(readSignRequest({ cardId: "c", pendingId: "p", allow: true })).toEqual({ cardId: "c", pendingId: "p", allow: true });
  });
});

describe("signPrompt", () => {
  it("names the worker after the card", () => {
    expect(signPrompt({ title: "Clean up" }, pending, true, undefined, "the worker m1mini (w1)")).toBe('allow Bash: rm -rf build, on "Clean up" on the worker m1mini (w1)');
  });
});

describe("findRequest", () => {
  const none = () => Promise.resolve([]);
  const macDevice = () => "mac-1";
  const req = { cardId: "card-9", pendingId: "p-1", allow: true };

  it("finds a worker card's waiting request with the worker's names", async () => {
    expect(await findRequest({ cards: none, workerAsk: workerAsk(), macDevice }, req)).toEqual({ card: ask.card, pending, orgId: "org-1", device: "worker:w1", worker: "w1" });
    expect(await findRequest({ cards: none, workerAsk: workerAsk(), macDevice }, { ...req, orgId: "org-1" })).toMatchObject({ orgId: "org-1" });
  });

  it.each([
    ["no row", () => Promise.resolve(null), /isn't on this Mac or one of your workers/],
    ["a failed read", () => Promise.reject(new Error("down")), /isn't on this Mac or one of your workers/],
    ["a device that isn't its worker's", workerAsk({ device: "worker:w2" }), /doesn't say which worker/],
    ["a device that isn't a worker's", workerAsk({ device: "mac-2", workerId: "mac-2" }), /doesn't say which worker/],
    ["no workspace", workerAsk({ orgId: "" }), /doesn't say which worker/],
    ["another request waiting", workerAsk({ card: { ...ask.card, pending: { ...pending, id: "p-2" } } }), /isn't waiting/],
    ["nothing waiting", workerAsk({ card: { ...ask.card, pending: null } }), /isn't waiting/],
  ])("refuses %s", async (_, read, why) => {
    expect(await findRequest({ cards: none, workerAsk: read, macDevice }, req)).toMatch(why);
  });

  it("refuses a workspace the board names that isn't the row's, and signs a Mac card over the workspace \"local\"", async () => {
    expect(await findRequest({ cards: none, workerAsk: workerAsk(), macDevice }, { ...req, orgId: "org-2" })).toMatch(/another workspace/);
    const here = () => Promise.resolve([{ id: "card-9", pending }]);
    expect(await findRequest({ cards: here, workerAsk: workerAsk(), macDevice }, req)).toMatchObject({ orgId: "local", device: "mac-1", worker: null });
    // A workspace the board names for this Mac's card is ignored: a local signature never names a real one.
    expect(await findRequest({ cards: here, workerAsk: workerAsk(), macDevice }, { ...req, orgId: "org-1" })).toMatchObject({ orgId: "local", device: "mac-1", worker: null });
  });
});

describe("serverWorkerAsk", () => {
  it("reads the row from main's own server with the read token", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ask }) }));
    vi.stubGlobal("fetch", fetch);
    expect(await serverWorkerAsk(() => ({ url: "http://127.0.0.1:1" }))("card 9")).toEqual(ask);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1/api/worker-board?ask=card%209", { headers: { "x-weft-token": "1" } });
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as never);
    expect(await serverWorkerAsk(() => ({ url: "http://127.0.0.1:1" }))("c")).toBeNull();
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: false }) as never);
    expect(await serverWorkerAsk(() => ({ url: "http://127.0.0.1:1" }))("c")).toBeNull();
    await expect(serverWorkerAsk(() => undefined)("c")).rejects.toThrow(/isn't up/);
  });
});

describe("approval:sign for a worker card, checked by the worker", () => {
  function setup(read: (cardId: string) => Promise<unknown> = workerAsk()) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-desk-worker-"));
    fs.writeFileSync(path.join(dataDir, "device-id"), "mac-1\n");
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = { id: "board" };
    const confirm = vi.fn<(reason: string) => Promise<boolean>>(() => Promise.resolve(true));
    const wired = setupPairing({ ipcMain, dataDir, accountClient: () => ({ supabase: fakeDb(), getClaims: () => ({ sub: "u1" }) }), isBoard: (x: unknown) => x === board, confirm, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, cards: () => Promise.resolve([]), workerAsk: read });
    const sign = (req: unknown) => handlers.get("approval:sign")!({ sender: board }, req) as Promise<{ device: string; issuedAt: number; sig: string; publicKey: string } | null>;
    return { wired, sign, confirm };
  }
  // The worker w1, pinning `key` as its pairing Mac.
  function worker(key: string, now: number) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-desk-w1-"));
    const signers = createHostSigners(home, [], memoryMacs([key]));
    return workerApprove({ host: "w1", orgId: "org-1", signers, nonces: nonceBook({ load: () => ({}), save: () => {} }, () => now), projects: () => [], root: "/w", projectPath: (f) => f, nameFolder: () => {}, now: () => now });
  }
  const card = { id: "card-9", cwd: "/w/app", pending } as unknown as Card;
  const answer = { cardId: "card-9", pendingId: "p-1", allow: true };
  const row = (auth: unknown) => ({ org_id: "org-x", target_device: "worker:wx", payload: { ...answer, auth } }) as unknown as CloudCommandRow;

  it("signs after Touch ID in main's words, and the worker that pinned this Mac takes it", async () => {
    const { wired, sign, confirm } = setup();
    const auth = (await sign({ ...answer, label: "Bash: ls", orgId: undefined }))!;
    expect(confirm).toHaveBeenCalledWith('allow Bash: rm -rf build, on "Clean up" on the worker (w1)');
    const approve = worker(wired.signer.publicKey(), auth.issuedAt);
    expect(await approve(row(auth), answer, card)).toBeNull();
    // Moved to another request, card or decision, it doesn't check out; nor on a worker that pinned another Mac.
    expect(await approve(row(auth), { ...answer, pendingId: "p-2" }, card)).toMatch(/isn't the pairing Mac's/);
    expect(await approve(row(auth), { ...answer, cardId: "card-8" }, card)).toMatch(/isn't the pairing Mac's/);
    expect(await approve(row(auth), { ...answer, allow: false }, card)).toMatch(/isn't the pairing Mac's/);
  });

  it("signs a grant in its words, and the worker takes it only with that grant", async () => {
    const { wired, sign, confirm } = setup();
    const auth = (await sign({ ...answer, grant: "card" }))!;
    expect(confirm.mock.calls[0]![0]).toContain("and for this card's folder");
    const approve = worker(wired.signer.publicKey(), auth.issuedAt);
    expect(await approve(row(auth), { ...answer, grant: "card" }, card)).toBeNull();
    expect(await approve(row(auth), { ...answer, grant: "always" }, card)).toMatch(/isn't the pairing Mac's/);
  });

  it("signs nothing when Touch ID is refused, or for a request it can't read waiting", async () => {
    const refused = setup();
    refused.confirm.mockResolvedValueOnce(false);
    expect(await refused.sign(answer)).toBeNull();
    const gone = setup(vi.fn(() => Promise.resolve(null)));
    await expect(gone.sign(answer)).rejects.toThrow(/one of your workers/);
    expect(gone.confirm).not.toHaveBeenCalled();
  });
});
