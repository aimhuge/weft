// What a worker got by default when it was paired (docs/architecture/weft-worker.md#defaults-at-pairing), as Settings →
// Devices says it after "Added m1mini.": main did each one under pairing's own Touch ID (electron/host-pairing.cjs), and
// hands back how each went. Nothing here decides anything; it only words main's outcomes.

type Outcome = { error?: string };
export interface PairingDefaults {
  passkeys?: Outcome & { passkeys?: number; phones?: number };
  github?: Outcome & { ok?: boolean; waiting?: boolean };
}

const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const say = (count: number, one: string) => (count === 1 ? `your ${one}` : `your ${count} ${one}s`);

function passkeysNote(p: NonNullable<PairingDefaults["passkeys"]>): string {
  if (p.error) return end(`Your passkeys can't approve there yet: ${p.error}`);
  const keys = p.passkeys ?? 0;
  const phones = p.phones ?? 0;
  if (!keys && !phones) return "";
  const who = [...(keys ? [say(keys, "passkey")] : []), ...(phones ? [say(phones, "phone")] : [])].join(" and ");
  return `${who.charAt(0).toUpperCase()}${who.slice(1)} can approve there.`;
}

function githubNote(g: NonNullable<PairingDefaults["github"]>): string {
  if (g.error) return end(`GitHub isn't on there: ${g.error}`);
  return g.waiting ? "GitHub is on for its cards once this Mac's key is confirmed: open the link Weft emailed you." : "GitHub is on for its cards.";
}

export function defaultsNote(d: PairingDefaults | undefined): string {
  if (!d) return "";
  return [d.passkeys ? passkeysNote(d.passkeys) : "", d.github ? githubNote(d.github) : ""].filter(Boolean).join(" ");
}

// Whether main signed a passkey set for the worker, so the board should send it as a `pin` now (lib/passkey-sync.ts).
export const passkeysSigned = (d: PairingDefaults | undefined): boolean => Boolean(d?.passkeys && !d.passkeys.error);
