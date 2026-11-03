// A Weft Worker's rule for an answer (docs/architecture/mobile-security.md, "The desktop signs too"): the `approve` of
// its CardRules (lib/worker-card-commands.ts), the same lib/approval-check.ts approvalProblem a Mac runs, with the
// worker's own approvers. A signed Allow must be the pairing Mac's desktop approval key (lib/worker-mac-keys.ts, pinned
// from the pairing code) or a passkey that Mac endorsed here (lib/host-signers.ts); an unsigned Allow on a permission
// request is refused while either is pinned. A Deny, or a question's answers, never needs a signature.
//
// The message is rebuilt from the worker's own names, never the row's: its workspace, `worker:<id>` (the owner_device
// worker_put_card gives its rows, so what the Mac and sign.weft.zip signed for) and, for a passkey, the folder name its
// row carries. A signature for another worker, card, request, decision or grant doesn't check out; a pending request
// answers once, and its id is a random UUID, so a replay finds nothing waiting.
import path from "node:path";
import { approvalProblem } from "./approval-check";
import type { CardRules } from "./host/dispatch";
import type { Card } from "./types";
import { workerDevice } from "./worker-commands";
import type { WorkerWiden } from "./worker-widen";

// What a Mac too old to sign (or weft.zip without a passkey) is told, in the thread's error, when its Allow is refused.
// The request stays waiting, so the card isn't stuck: an updated Mac or a trusted passkey answers it, or Deny does.
export const WORKER_UNSIGNED =
  "This worker takes an Allow only with your approval: give it in Weft on your Mac (Touch ID; update Weft if it doesn't ask), or with a passkey this worker trusts. The request is still waiting.";

const folderName = (card: Card) => path.basename(card.cwd);

export function workerApprove(w: WorkerWiden): NonNullable<CardRules["approve"]> {
  return (command, answer, card) => {
    const host = workerDevice(w.host);
    // An empty workspace (an old wiring that didn't pass one) only makes a message no signature matches: fail closed.
    const orgId = w.orgId ?? "";
    return approvalProblem({ org_id: orgId, target_device: host, payload: command.payload }, answer, card.pending, {
      verify: (body) => w.signers.verify(body),
      // Signers that can't count their keys count as one, so an unsigned Allow is refused rather than let through.
      approvers: () => Promise.resolve(w.signers.approvers?.() ?? 1),
      // No switch lets the web approve here: a settings.put from the network would turn it on.
      webApprovals: false,
      now: (w.now ?? Date.now)(),
      unsigned: WORKER_UNSIGNED,
      passkey: { self: { orgId, macDevice: host, folder: (w.folderOf ?? folderName)(card) }, verify: (body) => w.signers.verifyPasskey(body) },
    });
  };
}
