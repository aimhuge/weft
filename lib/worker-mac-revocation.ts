// A revoked pairing Mac stops being trusted on its workers (docs/architecture/device-registry.md#the-pairing-mac). The
// worker trusts one Mac, the one whose approval key came in its pairing code (lib/worker-mac-keys.ts). When that Mac is
// revoked anywhere (Settings → Devices on any Mac, or device_revoke), the database says so through worker_mac_state
// (supabase/migrations/*_worker_pairing_mac.sql), and this marks every key the box pinned revoked, for good: no secret
// answer, signed setting, endorsement, widening or re-pair approval signed by it counts from then on. The passkeys
// that Mac endorsed earlier stay as they are (they're your authenticators, not the Mac's, and they can't add a passkey
// or touch a secret); no newer set can reach them, since only that Mac could sign one.
//
// The database never adds a key here: a "revoked" from a stolen session costs the box its Mac (as device_revoke on the
// worker itself would). It may take back a revocation it reported, for the Mac this box is paired with now: when
// worker_mac_state names that Mac and says it isn't revoked, the keys the box pinned from its pairing code come off
// mac-revoked.json. Revocation never comes back in the database (the keep-revoked triggers, and a revoked row's host
// can't be linked later), so the only way it reads "not revoked" again is a fix there, like the 2026-11-02 one
// (supabase/migrations/20261111161951_forget_revoked_link.sql): a key row revoked before it was linked had been read as
// the whole Mac revoked, and m1mini stopped trusting the Mac it was paired with for good. A read that fails changes
// nothing; the next one tries again.
export interface MacState {
  mac: string | null;
  revoked: boolean;
}

export interface MacRevocationDeps {
  read(): Promise<unknown>;
  macs: { held(): string[]; revoked(): string[]; revoke(keys: string[]): void; unrevoke(keys: string[]): void };
  log(msg: string): void;
  everyMs?: number;
}

const EVERY_MS = 60_000;

export function readMacState(raw: unknown): MacState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.revoked !== "boolean") return null;
  return { mac: typeof r.mac === "string" ? r.mac : null, revoked: r.revoked };
}

// One check: true when it marked a key revoked just now.
export async function checkMacRevoked(deps: Omit<MacRevocationDeps, "everyMs">): Promise<boolean> {
  const state = readMacState(await deps.read());
  if (!state) return false;
  if (!state.revoked) {
    liftMark(deps, state.mac);
    return false;
  }
  const gone = deps.macs.revoked();
  const fresh = deps.macs.held().filter((k) => !gone.includes(k));
  if (!fresh.length) return false;
  deps.macs.revoke(fresh);
  deps.log(`Weft Worker: the Mac this box was paired with (${state.mac?.slice(0, 12) ?? "unknown"}…) was revoked, so it no longer trusts that Mac's approvals or secrets. Run weft-worker forget on the box, then pair it again (docs/architecture/weft-worker.md#forget-a-worker).`);
  return true;
}

// The database says the Mac this box is paired with isn't revoked: lift the mark from the keys it pinned for it.
function liftMark(deps: Omit<MacRevocationDeps, "everyMs">, mac: string | null) {
  if (!mac) return;
  const gone = deps.macs.revoked();
  const back = deps.macs.held().filter((k) => gone.includes(k));
  if (!back.length) return;
  deps.macs.unrevoke(back);
  deps.log(`Weft Worker: the Mac this box is paired with (${mac.slice(0, 12)}…) isn't revoked after all, so it trusts that Mac's approvals and secrets again.`);
}

// Checks at start and every minute; returns the stop.
export function startMacRevocationWatch(deps: MacRevocationDeps): () => void {
  let warned = false;
  const pass = () =>
    checkMacRevoked(deps).catch((err: unknown) => {
      if (!warned) deps.log(`Weft Worker: checking whether its Mac was revoked: ${(err as Error).message}`);
      warned = true;
    });
  void pass();
  const timer = setInterval(() => void pass(), deps.everyMs ?? EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
