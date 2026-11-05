// Type shim for ./server-patch-feed.cjs so the test file gets real types instead of `any`.
// The runtime module is unchanged; only TS uses these declarations.

// The details a patch's feed carries (patch.json's payload). Every field the app checks
// before it takes a patch: the app version, the build, the sequence number, the packages'
// fingerprint, where to download it and what it should hash to.
export interface PatchDetails {
  version: string;
  build: string;
  seq: number;
  deps: string;
  url: string;
  sha256: string;
  size: number;
  notes?: string;
  commit?: string;
}

// A signed feed: the details as a JSON string, and an ed25519 signature over that exact
// string. The signature is what vouches for the patch, since a patch runs code outside
// the signed .app.
export interface SignedFeed {
  payload: string;
  signature: string;
}

// The fields a payload must carry before the app looks at it.
export const FIELDS: string[];

// Signs the details with a base64 PKCS#8 DER ed25519 private key.
export function signPatch(details: PatchDetails, privateKeyB64: string): SignedFeed;

// The details of a feed (anything off the network) whose signature checks out against a base64 SPKI DER public key;
// throws otherwise.
export function verifyPatch(feed: unknown, publicKeyB64: string): PatchDetails;

// Why this Mac shouldn't take a patch, or null when it should.
export function whyNot(
  details: PatchDetails,
  local: { version: string; deps: string | null; activeSeq?: number; bad?: string[] },
): string | null;
