// The pure helpers behind the team's Devices page (app/[orgSlug]/team/devices). The page is a server
// component that reads the `devices` and `pending_device_grants` tables through the service client; the
// helpers here turn those rows into the plain shapes the client components render, and they own the
// fingerprint format the TOFU check compares.
//
// The fingerprint is the first 16 bytes of SHA-256 of a device's public key, shown as 8 groups of 4 hex
// characters: `a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789`. The device side (electron/device-fingerprint.cjs)
// writes it into `devices.fingerprint`; the granter pastes what they read off the other machine. Both
// sides must produce the same string, so the formatter here has to accept whatever the device wrote and
// normalize it to the display form.
//
// No secret ever passes through this file: a device row carries a public key and a fingerprint, never a
// wrapped key and never a value. The vault key never reaches the web side at all.
//
// Plain types and pure functions only — the client components import the formatter, so this file must
// not reach for a server-only module.

// One registered device, as the page renders it. `ownerId`/`ownerName` say whose machine it is; a
// recovery device has no owner and is listed separately by the page, not here.
export type TeamDevice = {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  name: string;
  platform: string;
  fingerprint: string;
  publicKey: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

// A grant waiting for the other side's TOFU check. `status` is the row's own: "pending", "accepted",
// "rejected", "expired". `targetUserId` is the user whose device is being added; `granterUserId` is the
// admin who asked for it. `matchedDeviceId` is set when the target accepted.
export type PendingDeviceGrant = {
  id: string;
  vaultId: string;
  vaultLabel: string;
  granterUserId: string;
  granterName: string | null;
  targetUserId: string;
  targetName: string | null;
  fingerprint: string;
  status: string;
  matchedDeviceId: string | null;
  createdAt: string;
  expiresAt: string;
};

// The raw `devices` row as Supabase returns it. The service client hands back plain objects, so the
// helper takes the loose shape and narrows it.
export type DeviceRow = {
  id: string;
  user_id: string | null;
  name: string;
  public_key: string;
  fingerprint: string;
  platform: string;
  last_seen_at: string;
  revoked_at: string | null;
};

// The raw `pending_device_grants` row.
export type PendingGrantRow = {
  id: string;
  vault_id: string;
  granter_user_id: string;
  target_user_id: string;
  target_fingerprint: string;
  status: string;
  matched_device_id: string | null;
  created_at: string;
  expires_at: string;
};

// How many hex characters one group holds. 16 bytes is 32 hex characters, in 8 groups of 4.
const GROUP = 4;
const GROUPS = 8;
// The whole fingerprint, without the separators: 16 bytes of hex.
const HEX_LENGTH = GROUP * GROUPS;

// The characters a fingerprint may be made of once the separators are gone.
const HEX_ONLY = /^[0-9a-f]+$/;

// Strip everything that isn't a hex character, so "a1b2-c3d4", "a1b2 c3d4" and "A1B2C3D4" all reduce to
// the same 32 characters. Returns null when what is left isn't exactly a 32-character hex string — a
// fingerprint of the wrong length is not a fingerprint, and showing it as one would make the TOFU
// comparison meaningless.
export function normalizeFingerprint(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== HEX_LENGTH) return null;
  if (!HEX_ONLY.test(hex)) return null;
  return hex;
}

// The display form: 8 groups of 4, separated by single spaces. `a1b2c3d4e5f67890abcdef0123456789`
// becomes `a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789`. A fingerprint we can't parse comes back as the raw
// string, so the page shows something rather than nothing — the user can still compare it by eye.
export function formatFingerprint(raw: string | null | undefined): string {
  const hex = normalizeFingerprint(raw);
  if (!hex) return typeof raw === "string" ? raw.trim() : "";
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) groups.push(hex.slice(i * GROUP, i * GROUP + GROUP));
  return groups.join(" ");
}

// Whether a fingerprint the user pasted can be used for a grant. The paste is what the other machine
// showed, so it may be in any of the shapes above; we only need it to reduce to 32 hex characters.
export function isValidFingerprint(raw: string | null | undefined): boolean {
  return normalizeFingerprint(raw) !== null;
}

// A device row to the shape the page renders. `ownerName` is looked up separately (the devices table
// carries a user id, not a name) and may be missing for a device whose owner left the workspace.
export function deviceView(row: DeviceRow, ownerName?: string | null): TeamDevice {
  return {
    id: row.id,
    ownerId: row.user_id,
    ownerName: ownerName ?? null,
    name: row.name,
    platform: row.platform,
    fingerprint: formatFingerprint(row.fingerprint),
    publicKey: row.public_key,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

// A pending grant row to the shape the page renders. The vault label and the two user names are looked
// up separately; a null name reads as the id's first segment, so a row is never nameless.
export function pendingGrantView(
  row: PendingGrantRow,
  extra: { vaultLabel?: string | null; granterName?: string | null; targetName?: string | null } = {},
): PendingDeviceGrant {
  return {
    id: row.id,
    vaultId: row.vault_id,
    vaultLabel: extra.vaultLabel ?? "",
    granterUserId: row.granter_user_id,
    granterName: extra.granterName ?? null,
    targetUserId: row.target_user_id,
    targetName: extra.targetName ?? null,
    fingerprint: formatFingerprint(row.target_fingerprint),
    status: row.status,
    matchedDeviceId: row.matched_device_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// The devices to show, in the order the page lists them: the viewer's own devices first, then everyone
// else's, each group by name. A revoked device sorts last within its group, so an active machine is
// never below a dead one.
export function sortDevices(devices: TeamDevice[], viewerId: string | null): TeamDevice[] {
  return [...devices].sort((a, b) => {
    const mine = (d: TeamDevice) => (viewerId && d.ownerId === viewerId ? 0 : 1);
    if (mine(a) !== mine(b)) return mine(a) - mine(b);
    const live = (d: TeamDevice) => (d.revokedAt ? 1 : 0);
    if (live(a) !== live(b)) return live(a) - live(b);
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

// The pending grants to show: the ones waiting on the viewer first (those are the ones they can act
// on), then the rest, newest first. A grant that is no longer pending drops out — the page shows the
// live queue, not the history.
export function sortPendingGrants(grants: PendingDeviceGrant[], viewerId: string | null): PendingDeviceGrant[] {
  const live = grants.filter((g) => g.status === "pending");
  return live.sort((a, b) => {
    const mine = (g: PendingDeviceGrant) => (viewerId && g.targetUserId === viewerId ? 0 : 1);
    if (mine(a) !== mine(b)) return mine(a) - mine(b);
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

// A short, human label for a platform: "macOS", "Linux", "Windows". Anything else shows as itself, so a
// platform we don't know about is still readable.
export function platformLabel(platform: string | null | undefined): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    case "win32":
      return "Windows";
    default:
      return platform?.trim() || "Unknown";
  }
}

// "3 days ago", "just now" — a relative time for a device's last seen. Falls back to the date when the
// timestamp is unparseable.
export function lastSeenLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
