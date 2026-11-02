// `weft-worker enrol wph.…`: enrolling a box by pairing it with the Mac that showed the code
// (docs/architecture/device-registry.md). The box makes its own key, signing key and seal key, claims the code with
// them through worker_pair_claim, prints the check code the Mac's Touch ID prompt will show, and waits until the Mac
// confirms. Its key never crosses the network to be issued: the server only ever holds its hash, as with worker_enrol.
import fs from "node:fs";
import path from "node:path";
import { checkCode, keyHash, makeHostClaim, newWorkerKey, parsePairCode, safeName, type SignKeys } from "./host-pairing";
import type { WorkerConfig } from "./worker-config";
import type { Rpc } from "./worker-registry";

export const PAIR_POLL_MS = 2_000;
// The code lives an hour; the Mac has ten minutes after that to confirm a claim.
export const PAIR_WAIT_MS = 70 * 60_000;

export interface PairBox {
  name: string;
  platform: string;
  arch: string;
  // The worker's seal key's public half (lib/worker-config.ts workerSealKeys).
  boxKey: string;
  sign: SignKeys;
}

interface PairStatus {
  status: "open" | "claimed" | "paired" | "cancelled";
  worker_id?: string;
  org_id?: string;
  owner_user?: string;
  device?: string;
}

export interface PairDeps {
  rpc: Rpc;
  say: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  makeKey?: () => string;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function call<T>(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export async function pairWorker(codeText: string, box: PairBox, deps: PairDeps): Promise<WorkerConfig> {
  const code = parsePairCode(codeText);
  if (!code) throw new Error("That pairing code isn't whole. Copy the line from Weft → Settings → Devices again.");
  const { rpc, say, sleep = wait, now = Date.now, makeKey = newWorkerKey } = deps;
  const key = makeKey();
  const name = safeName(box.name);
  const body = { name, platform: box.platform, arch: box.arch, box_key: box.boxKey, sign_key: box.sign.publicKey, key_hash: keyHash(key) };
  const claim = makeHostClaim(code, body, box.sign);
  const claimed = await call<boolean>(rpc, "worker_pair_claim", {
    p_pairing: code.id, p_name: claim.name, p_platform: claim.platform, p_arch: claim.arch, p_box_key: claim.box_key,
    p_sign_key: claim.sign_key, p_key_hash: claim.key_hash, p_proof: claim.proof, p_sig: claim.sig,
  });
  if (!claimed) throw new Error("That pairing code is used or expired. Make a new one in Weft → Settings → Devices.");
  say(`Claimed. Confirm on your Mac: its Touch ID prompt should show ${checkCode(code.id, code.orgId, body)}.`);
  const until = now() + PAIR_WAIT_MS;
  while (now() < until) {
    const s = await call<PairStatus>(rpc, "worker_pair_status", { p_pairing: code.id, p_key: key });
    if (s.status === "paired" && s.worker_id && s.org_id && s.owner_user && s.device) {
      return { workerId: s.worker_id, orgId: s.org_id, ownerUser: s.owner_user, device: s.device, key, name };
    }
    if (s.status === "cancelled") throw new Error("The Mac didn't pair this box. Make a new code and try again.");
    await sleep(PAIR_POLL_MS);
  }
  throw new Error("The Mac didn't confirm in time. Make a new code and try again.");
}

// sign-key.json: the worker's Ed25519 keypair, made when it first pairs, mode 600 like seal-key.json.
export function workerSignKeys(home: string, make: () => SignKeys): SignKeys {
  const file = path.join(home, "sign-key.json");
  try {
    const keys = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SignKeys>;
    if (typeof keys.publicKey === "string" && typeof keys.privateKey === "string") return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  } catch {
    // None yet, or damaged: make a fresh pair below.
  }
  const keys = make();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(keys)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return keys;
}
