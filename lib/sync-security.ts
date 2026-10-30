// What Electron main says about pairing (POST /pairing/status, electron/pairing-ipc.cjs): how many paired phones can
// approve, and Settings → Sync's two switches (seal synced threads, let the web approve without a phone). The switches
// live in main's sealed file, not here, so a thread calling the server's routes can't flip them
// (docs/architecture/mobile-security.md). When main should answer and doesn't, it reads as "a phone is paired": an
// unsigned Allow waits rather than slipping through.
import { shell } from "./browser-shell";

export interface PairingStatus {
  approvers: number;
  seal: boolean;
  webApprovals: boolean;
}

const NO_SHELL: PairingStatus = { approvers: 0, seal: false, webApprovals: false };
const UNREACHABLE: PairingStatus = { approvers: 1, seal: false, webApprovals: false };

export async function pairingStatus(): Promise<PairingStatus> {
  if (!process.env.WEFT_SHELL_URL) return NO_SHELL;
  try {
    const r = await shell("/pairing/status");
    return { approvers: Number(r.approvers) || 0, seal: r.seal === true, webApprovals: r.webApprovals === true };
  } catch {
    return UNREACHABLE;
  }
}
