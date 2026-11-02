import { describe, expect, it } from "vitest";
import { passkeyMessage, readPasskeyMessage } from "./approval-passkey";
import type { PendingPermission } from "./types";
import { approvalToSign, passkeyAuth } from "./web-passkey-approval";

const pending = { id: "p", toolName: "Bash", title: "Run", input: { command: "vercel deploy --prod" } } as PendingPermission;
const row = (p: PendingPermission | null = pending) => ({ org_id: "o", card_id: "c", owner_device: "mac", folder: "/w/app", card: { pending: p } as never });
const key = { device: "b1", credId: "Y3I" };

describe("approvalToSign", () => {
  it("is the message the Mac rebuilds, for an Allow on a permission request from a passkey browser", () => {
    const got = approvalToSign(row(), { allow: true }, key, 7);
    expect(got).toEqual({
      message: passkeyMessage({ orgId: "o", macDevice: "mac", cardId: "c", pendingId: "p", allow: true, issuedAt: 7 }, { ...pending, folder: "/w/app" }),
      device: "b1",
      credId: "Y3I",
      issuedAt: 7,
    });
    expect(readPasskeyMessage(got!.message)).toMatchObject({ tool: "Bash", input: pending.input, folder: "/w/app", grant: null });
  });

  it("is null when nothing needs signing, or a passkey can't sign it", () => {
    expect(approvalToSign(row(), { allow: true }, null, 1)).toBeNull();
    expect(approvalToSign(row(), { allow: false }, key, 1)).toBeNull();
    // A folder grant stays on the phone or the Mac.
    expect(approvalToSign(row(), { allow: true, grant: "always" }, key, 1)).toBeNull();
    expect(approvalToSign(row(null), { allow: true }, key, 1)).toBeNull();
    expect(approvalToSign(row({ ...pending, questions: [{}] } as never), { allow: true }, key, 1)).toBeNull();
    expect(approvalToSign(row({ ...pending, elicitation: {} } as never), { allow: true }, key, 1)).toBeNull();
    expect(approvalToSign(row({ ...pending, toolName: "mcp__secrets__run" }), { allow: true }, key, 1)).toBeNull();
  });
});

describe("passkeyAuth", () => {
  it("is the webauthn auth for the answer", () => {
    const sig = { authenticatorData: "a", clientDataJSON: "c", signature: "s" };
    expect(passkeyAuth({ message: "m", device: "b1", credId: "Y3I", issuedAt: 7 }, sig)).toEqual({ kind: "webauthn", device: "b1", credId: "Y3I", issuedAt: 7, ...sig });
  });
});
