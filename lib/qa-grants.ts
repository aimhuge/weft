// The yes behind Local Simulator mode, held on the Mac and nowhere else (docs/architecture/manual-qa.md). A build from a worker
// runs here as a macOS process with the user's permissions, so the switch's Touch ID (electron main, POST /qa/approve)
// writes a grant for one card, one worker and one device, for 8 hours. Every call a worker makes is checked against it.
// It lives in memory on purpose: a restarted Weft has forgotten it, and the next call is refused until you say yes again.
import { globalSingleton } from "./global-singleton";

export const QA_GRANT_MS = 8 * 60 * 60_000;

export interface QaGrant {
  cardId: string;
  workerId: string;
  device: string;
  name: string;
  until: number;
}

const grants = () => globalSingleton("__weftQaGrants", () => new Map<string, QaGrant>());

export function grantQa(grant: Omit<QaGrant, "until">, now = Date.now()): QaGrant {
  const full = { ...grant, until: now + QA_GRANT_MS };
  grants().set(grant.cardId, full);
  return full;
}

export const hasQaGrant = () => grants().size > 0;

export const revokeQa = (cardId: string) => void grants().delete(cardId);

// The grant a call stands on, or a throw the agent can read and pass on.
export function requireGrant(cardId: string, workerId: string, now = Date.now()): QaGrant {
  const grant = grants().get(cardId);
  if (!grant || grant.workerId !== workerId) throw new Error("Local Simulator isn't switched on for this thread on this Mac. Ask the user to switch it on in the thread's header.");
  if (now >= grant.until) {
    revokeQa(cardId);
    throw new Error("Local Simulator's 8 hours on this Mac are up. Ask the user to switch it on again in the thread's header.");
  }
  return grant;
}

// The grant for a card, for the board's switch to read. Nothing about a lapsed one.
export function activeGrant(cardId: string, now = Date.now()): QaGrant | undefined {
  const grant = grants().get(cardId);
  return grant && now < grant.until ? grant : undefined;
}
