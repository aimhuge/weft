// The shapes every host-api handler shares (docs/architecture/project-hosts.md): a verb's name, its handler and the
// one error a route turns into a 404.
import { getCard } from "../store";
import type { Card } from "../types";

/** Every verb a host runs: @weft/client's list (HOST_VERBS), which the table in ./index.ts is keyed by. */
export type { HostVerb } from "@weft/client";

/**
 * One verb's handler: a plain function of its args. `elevated` says the verb grants power, so a local route checks it
 * with `elevated()` rather than `guard()` (lib/guard.ts); `elevatedFor` marks a verb that grants power only for some
 * args (a card update that loosens the mode or grants a read).
 */
export interface Handler<A = never, R = unknown> {
  elevated: boolean;
  elevatedFor?: (args: A) => boolean;
  run(args: A): Promise<R>;
}

/** The card a verb names isn't on this host: a local route answers 404. */
export class NotFound extends Error {}

export function requireCard(id: string): Card {
  const card = getCard(id);
  if (!card) throw new NotFound("No such card.");
  return card;
}

/** The reply most card verbs give. */
export type Ok = { ok: true };
export const OK: Ok = { ok: true };

/** A synchronous handler body as a handler's promise: it runs now, and a throw becomes a rejection. */
export function settle<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}
