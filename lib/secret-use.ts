// The wire of a worker's secret run (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built).
// A worker card's mcp__secrets__run asks its owner's Mac with a `secret_run` device call (SecretAsk: names, never
// values); Electron main approves with Touch ID and answers with a `secret_use` command whose values are sealed to the
// worker for this card, this ask's nonce and this exact command. Both sides read these shapes, so they can't drift;
// electron/worker-secret.cjs is main's reader of the ask, and electron/worker-seal.cjs computes the same purpose.
import { createHash } from "node:crypto";
import type { CloudCommandRow } from "./cloud-commands";
import { sealedOf, type Sealed } from "./worker-seal";

export const SECRET_ASK_TOOL = "secret_run";
export const SECRET_USE_KIND = "secret_use";
// How long an ask waits for the user's Touch ID and the sealed answer.
export const ASK_MS = 5 * 60_000;

const ENVIRONMENTS = ["development", "preview", "production"] as const;
const NONCE = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// What the worker asks the Mac for. Names, never values; remote is the checkout's git origin, which names the vault.
export interface SecretAsk {
  nonce: string;
  command: string;
  names: string[];
  environment: string;
  cwd: string;
  remote: string;
  expiresAt: number;
  timeoutMs: number;
  script?: string;
  why?: string;
  thread?: string;
  // The worker's signature over askMessage, base64, when it was paired with a sign key (H10).
  sig?: string;
}

// What main seals: the ask it answers, repeated inside the seal, and the values.
export interface OpenedUse {
  card: string;
  nonce: string;
  command: string;
  names: string[];
  environment: string;
  expiresAt: number;
  values: Record<string, string>;
}

// The seal's purpose: a payload sealed for another card, ask or command won't open as this one.
export function secretUsePurpose(card: string, nonce: string, command: string): string {
  return `secret-use:${card}:${nonce}:${createHash("sha256").update(command, "utf8").digest("hex")}`;
}

// What the Mac signs with its device key (electron/desktop-signer.cjs) for a secret_use: the card, the ask and the sealed
// bytes, so a row sealed by anyone else (the worker's public key is public) carries no signature the worker trusts.
// electron/worker-seal.cjs secretUseMessage is the same, checked by a test.
export function secretUseMessage(card: string, nonce: string, sealed: Sealed): string {
  return ["weft-secret-use-v1", card, nonce, sealed.epk, sealed.iv, sealed.ct, sealed.tag].join("\n");
}

// What a paired worker signs for an ask with its sign key (H10); electron/worker-secret.cjs askMessage is the same, and
// main refuses an unsigned ask from a worker it pinned with a sign key.
// boxKey is the worker's seal key, so the signature also covers the key main seals the values to (after a Re-pin too).
export function askMessage(cardId: string, boxKey: string, a: Pick<SecretAsk, "nonce" | "command" | "names" | "environment" | "remote" | "cwd" | "script" | "expiresAt">): string {
  return JSON.stringify(["weft-secret-ask-v2", cardId, boxKey, a.nonce, a.command, a.names, a.environment, a.remote, a.cwd, a.script ?? null, a.expiresAt]);
}

export const newNonce = (bytes: (n: number) => Buffer) => bytes(32).toString("hex");

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
// A run names up to 20; a dev server's env carries the vault's whole development set (lib/worker-dev-env.ts).
const MAX_NAMES = 200;
const isNames = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_NAMES && v.every((n) => typeof n === "string" && NAME.test(n));
const isEnvironment = (v: unknown): v is string => ENVIRONMENTS.some((e) => e === v);

// A secret_use as the worker reads it off the network, or null when it isn't one.
export function secretUseBody(command: Pick<CloudCommandRow, "payload">): { cardId: string; nonce: string; sealed: Sealed; mac: { key: string; sig: string } | null } | null {
  const p: unknown = command.payload;
  if (!isObject(p) || typeof p.cardId !== "string" || !p.cardId || typeof p.nonce !== "string" || !NONCE.test(p.nonce)) return null;
  const sealed = sealedOf(p.sealed);
  const m = isObject(p.mac) ? p.mac : {};
  const mac = typeof m.key === "string" && typeof m.sig === "string" && m.key && m.sig ? { key: m.key, sig: m.sig } : null;
  return sealed ? { cardId: p.cardId, nonce: p.nonce, sealed, mac } : null;
}

// The opened plaintext, each field the type it must be, or null.
export function openedUse(text: string): OpenedUse | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.v !== 1) return null;
  const { card, nonce, command, names, environment, expiresAt, values } = raw;
  if (typeof card !== "string" || typeof nonce !== "string" || typeof command !== "string" || typeof expiresAt !== "number") return null;
  if (!isNames(names) || !isEnvironment(environment) || !isObject(values)) return null;
  if (!Object.values(values).every((v) => typeof v === "string")) return null;
  return { card, nonce, command, names, environment, expiresAt, values: values as Record<string, string> };
}

// Two name lists that ask for the same secrets, in any order.
export const sameNames = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
