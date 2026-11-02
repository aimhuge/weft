// Re-pairing an enrolled Weft Worker, the box's half (docs/architecture/project-hosts.md#re-pairing-a-worker). Pairing
// chooses the Mac a box takes secret answers and signed settings from, so an enrolled box swaps that Mac only on an
// approval signed by the Mac it trusts now (mac-keys.json): Settings → Devices → Approve re-pair, after Touch ID,
// signs `weft-repair-v1` over this worker, the new Mac's key and the new code's pairing and workspace
// (electron/worker-repair.cjs, main's copy; lib/worker-repair.test.ts proves the two agree). A terminal alone never
// did it: a thread fakes one with any pty. The approval travels by hand as one `wra.` line, so nothing a thread does
// puts a prompt on the Mac.
import crypto from "node:crypto";
import { parsePairCode, type HostPairCode } from "./host-pairing";
import { macSigned } from "./worker-mac-keys";

export const REPAIR_PREFIX = "wra.";
// An approval is for now, not for later: half an hour to carry it to the box, a little clock skew either way.
export const REPAIR_TTL_MS = 30 * 60_000;
export const REPAIR_SKEW_MS = 2 * 60_000;

export interface RepairApproval {
  issuedAt: number;
  // 16 random bytes, hex.
  nonce: string;
  // The trusted Mac's Ed25519 signature over repairMessage, base64.
  sig: string;
}

export interface RepairFields {
  worker: string;
  // The new Mac's raw Ed25519 key, base64, as the code carries it (parsePairCode).
  newMacKey: string;
  pairingId: string;
  orgId: string;
  issuedAt: number;
  nonce: string;
}

export const repairMessage = (f: RepairFields) =>
  ["weft-repair-v1", f.worker, f.newMacKey, f.pairingId, f.orgId, String(f.issuedAt), f.nonce].join("\n");

// `wra.<issuedAt>.<nonce>.<sig, base64url>`: shell-safe, like a pairing code.
export const repairLine = (a: RepairApproval) =>
  `${REPAIR_PREFIX}${a.issuedAt}.${a.nonce}.${Buffer.from(a.sig, "base64").toString("base64url")}`;

export function parseRepairLine(text: string): RepairApproval | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(REPAIR_PREFIX)) return null;
  const [at = "", nonce = "", sig = "", ...rest] = trimmed.slice(REPAIR_PREFIX.length).split(".");
  if (rest.length || !/^\d{1,15}$/.test(at) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[A-Za-z0-9_-]{86}$/.test(sig)) return null;
  return { issuedAt: Number(at), nonce, sig: Buffer.from(sig, "base64url").toString("base64") };
}

// A Mac key's short fingerprint, the one the Mac's Touch ID prompt and the box both print: 8 bytes of its hash.
export function macFingerprint(key: string): string {
  const hex = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 16);
  return [0, 4, 8, 12].map((i) => hex.slice(i, i + 4)).join(" ");
}

export interface RepairCheck {
  // The Mac keys this box trusts now (mac-keys.json).
  pinned: string[];
  // This box's worker id (worker.json).
  worker: string;
  code: string;
  approval: string | undefined;
  now: number;
}

// Why this enrolled box mustn't re-pair with this code, or null when its trusted Mac approved exactly this.
export function repairRefusal({ pinned, worker, code, approval, now }: RepairCheck): string | null {
  const parsed: HostPairCode | null = parsePairCode(code);
  if (!parsed) return "An enrolled box re-pairs only with a pairing code (wph.…) from Settings → Devices, never a token. To enrol it afresh, wipe it first (docs/architecture/weft-worker.md#re-pairing-and-a-lost-mac).";
  if (!parsed.macKey) return "That pairing code carries no Mac key. Make a new one in Weft → Settings → Devices.";
  if (!pinned.length) return "This box trusts no Mac, so none can approve a re-pair. Wipe it and enrol it afresh (docs/architecture/weft-worker.md#re-pairing-and-a-lost-mac).";
  const fp = macFingerprint(parsed.macKey);
  const how = `On the Mac this box trusts now (${pinned.map(macFingerprint).join(", ")}), open Settings → Devices → this worker → Approve re-pair, paste this code, and run the command it shows.`;
  if (approval === undefined) return `Re-pairing makes this box trust the Mac ${fp} instead. ${how}`;
  const a = parseRepairLine(approval);
  if (!a) return `That approval isn't a whole wra.… line. ${how}`;
  if (a.issuedAt > now + REPAIR_SKEW_MS || now - a.issuedAt > REPAIR_TTL_MS) return `That approval has expired. ${how}`;
  const message = repairMessage({ worker, newMacKey: parsed.macKey, pairingId: parsed.id, orgId: parsed.orgId, issuedAt: a.issuedAt, nonce: a.nonce });
  if (!pinned.some((key) => macSigned(key, message, a.sig))) return `That approval wasn't signed by the Mac this box trusts, for this worker and this code. ${how}`;
  return null;
}
