// A key grant for tests (lib/worker-key-grant.ts), made the way electron/worker-key-grants.cjs makes one: the key sealed
// to the worker's box key under its purpose, signed by a Mac's approval key over grantMessage.
import crypto from "node:crypto";
import { macSigner } from "./mac-signer.harness";
import { grantMessage, grantPurpose, type GrantRow } from "./worker-key-grant";
import { newSealKeys, seal, type SealKeys } from "./worker-seal";

export const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const WORKER = "11111111-2222-4333-8444-555555555555";

export const newSyncKey = () => crypto.randomBytes(32).toString("base64");

export function grantKit(keys: SealKeys = newSealKeys(), mac = macSigner()) {
  const make = (version: number, key = newSyncKey(), over: Partial<GrantRow> = {}, purpose = grantPurpose(ORG, WORKER, version)): GrantRow => {
    const sealed = JSON.stringify(seal(keys.publicKey, key, purpose));
    const sig = mac.sign(grantMessage({ orgId: ORG, workerId: WORKER, version, boxKey: keys.publicKey, sealed }));
    return { org_id: ORG, worker_id: WORKER, version, box_key: keys.publicKey, sealed, mac_device: "mac-1", sig, ...over };
  };
  return { keys, mac, make, ctx: (macs = [mac.key]) => ({ orgId: ORG, workerId: WORKER, keys, macs }) };
}
