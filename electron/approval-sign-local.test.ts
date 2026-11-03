// The desktop's signed Allow on this Mac's own card (electron/approval-sign.cjs, lib/local-approve.ts): main reads the
// card from its own server, words Touch ID from it, and signs over this Mac's id and the workspace "local"; the local
// route checks it through main's POST /pairing/verify, and the same signature never checks out as a network answer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { approvalProblem } from "../lib/approval-check";
import { localApprovalProblem } from "../lib/local-approve";
import type { Card, PendingPermission } from "../lib/types";
import { fakeDb, fakeSafeStorage } from "./pairing.harness";
import { setupPairing } from "./pairing-ipc.cjs";
import vaultCrypto from "./vault-crypto.cjs";

beforeAll(async () => {
  await vaultCrypto.ready();
});

const pending = { id: "p-1", toolName: "Bash", title: "Run", input: { command: "codex --yolo" } } as PendingPermission;
const card = { id: "card-1", title: "Ship it", pending } as unknown as Card;

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-desk-local-"));
  fs.writeFileSync(path.join(dataDir, "device-id"), "mac-1\n");
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
  const board = { id: "board" };
  const confirm = vi.fn<(reason: string) => Promise<boolean>>(() => Promise.resolve(true));
  const wired = setupPairing({ ipcMain, dataDir, accountClient: () => ({ supabase: fakeDb(), getClaims: () => ({ sub: "u1" }) }), isBoard: (x: unknown) => x === board, confirm, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, cards: () => Promise.resolve([card]), workerAsk: () => Promise.resolve(null) });
  const sign = (req: unknown) => handlers.get("approval:sign")!({ sender: board }, req) as Promise<{ device: string; issuedAt: number; sig: string } | null>;
  const verify = wired.routes["POST /pairing/verify"] as (b: { device: string; message: string; sig: string }) => Promise<{ ok: boolean; reason?: string }>;
  return { sign, verify, confirm };
}

describe("approval:sign for this Mac's card, checked by the local route", () => {
  it("signs after Touch ID in main's words, and the route's rule takes exactly that answer", async () => {
    const { sign, verify, confirm } = setup();
    const signed = (await sign({ cardId: "card-1", pendingId: "p-1", allow: true }))!;
    expect(confirm).toHaveBeenCalledWith('allow Bash: codex --yolo, on "Ship it"');
    const auth = { device: signed.device, issuedAt: signed.issuedAt, sig: signed.sig };
    const deps = { verify, self: "mac-1", now: signed.issuedAt };
    expect(await localApprovalProblem(card, { allow: true, pendingId: "p-1", auth }, deps)).toBeNull();
    expect(await localApprovalProblem(card, { allow: false, pendingId: "p-1", auth }, deps)).toMatch(/signature/);
    expect(await localApprovalProblem(card, { allow: true, pendingId: "p-1", auth }, { ...deps, self: "mac-2" })).toMatch(/signature/);
    // As a network answer, rebuilt with the command's real workspace, it doesn't check out.
    const network = await approvalProblem({ org_id: "org-1", target_device: "mac-1", payload: { auth } as never }, { cardId: "card-1", pendingId: "p-1", allow: true }, pending, {
      verify,
      approvers: () => Promise.resolve(1),
      webApprovals: false,
      now: signed.issuedAt,
    });
    expect(network).toMatch(/signature/);
  });

  it("signs nothing when Touch ID is refused, or for a request that isn't waiting", async () => {
    const { sign, confirm } = setup();
    confirm.mockResolvedValueOnce(false);
    expect(await sign({ cardId: "card-1", pendingId: "p-1", allow: true })).toBeNull();
    await expect(sign({ cardId: "card-1", pendingId: "p-0", allow: true })).rejects.toThrow(/isn't waiting/);
  });
});
