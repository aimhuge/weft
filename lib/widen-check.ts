// A host's check of a signed widening (docs/architecture/project-hosts.md#signed-widening-as-built): run by the `host`
// kind (lib/host/dispatch.ts), a worker's new thread (lib/worker-kinds.ts) and the line's terminal
// (lib/host-line-terminal.ts) before anything that remoteRefusal would turn away. The approval must be fresh, unused,
// over exactly this action as this host names it (its own id, the card, the verb, the change), and signed by a key this
// host pinned: the Mac's own server asks Electron main (POST /pairing/verify, /pairing/passkey-verify), a worker reads
// its pins (lib/host-signers.ts). The same Ed25519 and WebAuthn checks as an answer's (lib/approval-check.ts), over a
// message of its own.
import { BIDI, BIDI_REFUSED } from "./approval-passkey";
import { phoneOnly, PHONE_ONLY } from "./passkey-phone-only";
import { freshWiden, readWidenAuth, widenMessage, WIDEN_TTL_MS, type WidenChange, type WidenVerb } from "./widen";
import type { NonceBook } from "./widen-nonces";

export type Verified = { ok: boolean; reason?: string };

export interface WidenDeps {
  // This host as it names itself: a Mac's lib/device-id.ts id, a worker's id.
  host: string;
  now: number;
  nonces: NonceBook;
  // An Ed25519 signature: a pinned phone's or this Mac's own on a Mac, a pinned Mac's on a worker.
  verify(body: { device: string; message: string; sig: string }): Promise<Verified>;
  // A passkey's assertion, against the pin, its counter kept. Absent, a passkey can't widen here.
  passkey?(body: { device: string; credId: string; message: string; authenticatorData: string; clientDataJSON: string; signature: string }): Promise<Verified>;
  // A host's own limit on the new value (a worker's project folders), or null.
  confine?(change: WidenChange): string | null;
  // Whether a passkey may sign a "!" line here: a Mac whose Settings → Sync lets the web approve. A passkey on a "!"
  // line is a shell for whoever holds it, and no list of risky commands (H7's phoneOnly) holds against obfuscation.
  passkeyShell?: boolean;
}

export interface WidenTarget {
  card: string;
  verb: WidenVerb;
  change: WidenChange;
  // The rest of the command as this host read it (lib/widen.ts widenArgsOf, createTerms), bound whole.
  args: Record<string, unknown>;
}

export const STALE = "That approval is too old, or its clock is off. Approve it again.";
export const USED = "That approval was used already. Approve it again.";
export const NO_PASSKEY_HERE = "This host can't check a passkey yet. Approve it in Weft on your Mac.";
// What a passkey may not widen, as for an answer (lib/passkey-phone-only.ts): skipping permission prompts and a folder
// grant stay on the phone or the Mac, where the prompt is native.
export const PASSKEY_TOO_WIDE = "Skipping permission prompts or granting a folder needs your phone or Weft on your Mac, not a browser.";
// Where a Goose card's traffic and key go (a worker's settings.put): only the Mac's Touch ID key, never a browser's passkey.
export const PASSKEY_NO_GOOSE = "Pointing Goose at another provider or endpoint needs Touch ID in Weft on your Mac, not a browser.";
export const PASSKEY_NO_SHELL = "A \"!\" line needs your phone or Weft on your Mac, not a browser (unless Settings → Sync on your Mac lets the web approve).";

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

// What a passkey can't sign: the H7 rule for answers, read over the change as a Bash command would be.
function passkeyRefusal(change: WidenChange, shell: boolean): string | null {
  if (change.permissionMode || change.readScope !== undefined) return PASSKEY_TOO_WIDE;
  if (change.goose !== undefined) return PASSKEY_NO_GOOSE;
  const command = change.shell ?? change.schedule;
  if (command === undefined) return null;
  if (!shell) return PASSKEY_NO_SHELL;
  return phoneOnly({ toolName: "Bash", input: { command } }) ? PHONE_ONLY : null;
}

// Why this widening can't run, or null when it can. `refusal` is what the host says without an approval.
export async function widenProblem(target: WidenTarget, raw: unknown, refusal: string, deps: WidenDeps): Promise<string | null> {
  const auth = readWidenAuth(raw);
  if (!auth) return refusal;
  if (!freshWiden(auth.issuedAt, deps.now)) return STALE;
  if (await deps.nonces.has(auth.nonce)) return USED;
  if (strings(target.change).some((s) => BIDI.test(s))) return BIDI_REFUSED;
  const kept = deps.confine?.(target.change);
  if (kept) return kept;
  const message = widenMessage({ host: deps.host, card: target.card, verb: target.verb, change: target.change, args: target.args, nonce: auth.nonce, issuedAt: auth.issuedAt });
  let verified: Verified;
  if (auth.kind === "ed25519") verified = await deps.verify({ device: auth.device, message, sig: auth.sig });
  else {
    const why = passkeyRefusal(target.change, deps.passkeyShell === true) ?? (deps.passkey ? null : NO_PASSKEY_HERE);
    if (why) return why;
    const { device, credId, authenticatorData, clientDataJSON, signature } = auth;
    verified = await (deps.passkey as NonNullable<WidenDeps["passkey"]>)({ device, credId, message, authenticatorData, clientDataJSON, signature });
  }
  if (!verified.ok) return verified.reason ?? "That approval's signature doesn't check out.";
  // Taken after the check, in one step: of two commands racing with one approval, only the first runs.
  return (await deps.nonces.take(auth.nonce, auth.issuedAt + WIDEN_TTL_MS + 60_000, auth.issuedAt)) ? null : USED;
}
