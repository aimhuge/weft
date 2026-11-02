// The desktop signs like every other view (electron/desktop-signer.cjs): main's copy of the approval message agrees
// with lib/approval-sig.ts byte for byte, main signs after Touch ID for the board window only, and the signature checks
// on the one verify path the phone's takes (lib/approval-check.ts approvalProblem → POST /pairing/verify).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { approvalProblem } from "../lib/approval-check";
import { approvalMessage as tsMessage, type ApprovalFields } from "../lib/approval-sig";
import type { CloudCommandRow } from "../lib/cloud-commands";
import { sodium as loadSodium, type Sodium } from "../lib/sodium";
import { approvalMessage, createDesktopSigner } from "./desktop-signer.cjs";
import { fakeDb, fakeSafeStorage } from "./pairing.harness";
import { setupPairing } from "./pairing-ipc.cjs";
import vaultCrypto from "./vault-crypto.cjs";

let s: Sodium;
beforeAll(async () => {
  s = await loadSodium();
  await vaultCrypto.ready();
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-desk-sign-"));
const fields: ApprovalFields = { orgId: "org-1", macDevice: "mac-1", cardId: "card-1", pendingId: "p-1", allow: true, issuedAt: 1_700_000_000_000 };

describe("approvalMessage", () => {
  it.each([
    fields,
    { ...fields, allow: false },
    { ...fields, answers: { b: "2", a: "1" } },
    { ...fields, answers: {} },
    { ...fields, grant: "always" as const },
  ] as ApprovalFields[])("matches lib/approval-sig.ts", (f) => {
    expect(approvalMessage(s, f)).toBe(tsMessage(s, f));
  });
});

describe("createDesktopSigner", () => {
  it("makes one key, keeps it sealed in the vault, and signs and verifies with it", () => {
    const dir = tmp();
    const signer = createDesktopSigner({ dir, safeStorage: fakeSafeStorage, sodium: () => s });
    expect(signer.verify("m", "AAAA")).toBe(false);
    const key = signer.publicKey();
    expect(signer.file).toBe(path.join(dir, "vault", "desktop-sign-key.json"));
    expect(fs.readFileSync(signer.file, "utf8")).not.toContain(key);
    const sig = signer.sign("hello");
    expect(signer.verify("hello", sig)).toBe(true);
    expect(signer.verify("hullo", sig)).toBe(false);
    expect(signer.verify("hello", "not base64!")).toBe(false);
    // A second signer (Weft restarted) reads the same key back.
    const again = createDesktopSigner({ dir, safeStorage: fakeSafeStorage, sodium: () => s });
    expect(again.publicKey()).toBe(key);
    expect(again.verify("hello", sig)).toBe(true);
  });

  it("never replaces a key file it can't read", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "vault"));
    const file = path.join(dir, "vault", "desktop-sign-key.json");
    fs.writeFileSync(file, fakeSafeStorage().encryptString(JSON.stringify({ publicKey: 1 })).toString("base64"));
    const signer = createDesktopSigner({ dir, safeStorage: fakeSafeStorage, sodium: () => s });
    expect(() => signer.sign("m")).toThrow(/unreadable/);
    expect(signer.verify("m", "AAAA")).toBe(false);
    expect(JSON.parse(fakeSafeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")))).toEqual({ publicKey: 1 });
  });
});

describe("approval:sign", () => {
  const CARDS = [
    { id: "card-1", title: "Fix the login page", pending: { id: "p-1", toolName: "Bash", input: { command: "rm -rf ~/dev/shop" } } },
    { id: "card-2", title: "Idle", pending: null },
  ];
  function setup(confirm = vi.fn<(reason: string) => Promise<boolean>>(() => Promise.resolve(true))) {
    const dataDir = tmp();
    fs.writeFileSync(path.join(dataDir, "device-id"), "mac-1\n");
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = { id: "board" };
    const cards = () => Promise.resolve(CARDS);
    const wired = setupPairing({ ipcMain, dataDir, accountClient: () => ({ supabase: fakeDb(), getClaims: () => ({ sub: "u1" }) }), isBoard: (x: unknown) => x === board, confirm, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, cards });
    const sign = (req: unknown, sender: unknown = board) => handlers.get("approval:sign")!({ sender }, req) as Promise<{ device: string; issuedAt: number; sig: string; publicKey: string } | null>;
    return { wired, sign, confirm, dataDir };
  }
  const answer = { cardId: "card-1", pendingId: "p-1", allow: true };
  type Command = Pick<CloudCommandRow, "org_id" | "target_device" | "payload">;
  const cmd = (target: string, auth: unknown): Command => ({ org_id: "org-1", target_device: target, payload: { auth } as unknown as CloudCommandRow["payload"] });
  const deps = (wired: ReturnType<typeof setup>["wired"], now: number) => ({
    verify: (b: { device: string; message: string; sig: string }) => wired.routes["POST /pairing/verify"](b) as Promise<{ ok: boolean; reason?: string }>,
    approvers: () => Promise.resolve(1),
    webApprovals: false,
    now,
  });

  it("signs after Touch ID, and the host checks it on the phone's path", async () => {
    const { wired, sign, confirm } = setup();
    const auth = (await sign({ orgId: "org-1", ...answer }))!;
    expect(confirm).toHaveBeenCalledWith('allow Bash: rm -rf ~/dev/shop, on "Fix the login page"');
    expect(auth).toMatchObject({ device: "mac-1", publicKey: wired.signer.publicKey() });
    const command = cmd("mac-1", auth);
    expect(await approvalProblem(command, answer, null, deps(wired, auth.issuedAt))).toBeNull();
    // Moved onto another request, card or host, it no longer checks out.
    expect(await approvalProblem(command, { ...answer, pendingId: "p-2" }, null, deps(wired, auth.issuedAt))).toMatch(/doesn't check out/);
    expect(await approvalProblem(cmd("worker:w", auth), answer, null, deps(wired, auth.issuedAt))).toMatch(/doesn't check out/);
    // This Mac's own key isn't a paired approver.
    expect(wired.routes["POST /pairing/status"]()).toMatchObject({ approvers: 0 });
  });

  it("builds the prompt from main's own copy: a misleading label or host from the board never reaches it", async () => {
    const { wired, sign, confirm } = setup();
    const auth = (await sign({ orgId: "org-1", ...answer, label: "Bash: ls", host: "worker:w", title: "harmless" }))!;
    const prompt = confirm.mock.calls[0]![0];
    expect(prompt).toContain("rm -rf ~/dev/shop");
    expect(prompt).not.toMatch(/ls$|harmless|worker/);
    // Signed for this Mac, not the host the board named.
    expect(await approvalProblem(cmd("mac-1", auth), answer, null, deps(wired, auth.issuedAt))).toBeNull();
  });

  it("says a deny and a grant in its own words", async () => {
    const { sign, confirm } = setup();
    await sign({ orgId: "org-1", ...answer, allow: false });
    await sign({ orgId: "org-1", ...answer, grant: "always" });
    expect(confirm.mock.calls.map((c) => c[0])).toEqual([
      'deny Bash: rm -rf ~/dev/shop, on "Fix the login page"',
      'allow Bash: rm -rf ~/dev/shop and always for its folder, on "Fix the login page"',
    ]);
  });

  it("refuses a request it can't see waiting on this Mac", async () => {
    const { sign, confirm } = setup();
    await expect(sign({ orgId: "org-1", ...answer, cardId: "elsewhere" })).rejects.toThrow(/isn't on this Mac/);
    await expect(sign({ orgId: "org-1", ...answer, cardId: "card-2" })).rejects.toThrow(/isn't waiting/);
    await expect(sign({ orgId: "org-1", ...answer, pendingId: "p-0" })).rejects.toThrow(/isn't waiting/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("signs nothing when Touch ID is refused, for a bad request, or for another window", async () => {
    const { sign } = setup(vi.fn(() => Promise.resolve(false)));
    expect(await sign({ orgId: "org-1", ...answer })).toBeNull();
    await expect(sign({ orgId: "org-1" })).rejects.toThrow(/missing/);
    await expect(Promise.resolve(sign({ orgId: "org-1", ...answer }, { id: "pane" }))).rejects.toThrow(/board window/);
  });

  it("refuses this Mac's id when it has no device id yet", async () => {
    const { wired, dataDir } = setup();
    fs.rmSync(path.join(dataDir, "device-id"));
    expect(await wired.routes["POST /pairing/verify"]({ device: "mac-1", message: "m", sig: "s" })).toEqual({ ok: false, reason: "That device isn't paired with this Mac." });
  });
});
