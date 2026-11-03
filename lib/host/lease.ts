// Leases on claimed commands (supabase/migrations/20261103070200_command_leases.sql, docs/architecture/weft-worker.md#leases).
// A claim holds a command for LEASE_MS. While the host runs it, its beat renews the lease (lib/host/beat.ts); at the
// start of a pass the host puts back in the queue its own expired claims, but only for a verb safe to run twice
// (IDEMPOTENT_VERBS, the reads flagged `idempotent` in lib/host-api). A command that makes a card or starts a turn stays
// claimed and is never run again: twice would be worse than never.
//
// Both hosts run this (the Mac's inbox and the Weft Worker's), on whatever database they reach. One that predates the
// migration has no lease column or functions: the first such error turns leases off for an hour, said once, and the
// inbox runs exactly as it did before.
import { HOST_API, type HostVerb } from "../host-api";
import type { Handler } from "../host-api/types";
import type { CommandLine } from "./identity";

// Matches the migration's interval: a claim's lease, and how often a held one is renewed (three tries a lease).
export const LEASE_MS = 3 * 60_000;
export const RENEW_EVERY_MS = 60_000;
export const RECLAIM_EVERY_MS = 60_000;
// How long a database without leases is left alone before asking again (it may have been migrated meanwhile).
export const RETRY_OFF_MS = 60 * 60_000;
// The functions take at most 100 ids at a time.
const RENEW_MAX = 100;

// The verbs a host requeues when their lease runs out, read from the host-api table so a new verb opts in where it's
// defined. Today: skills.list, files.list, files.read, settings.get, dev.log.
export const IDEMPOTENT_VERBS: HostVerb[] = (Object.keys(HOST_API) as HostVerb[]).filter((v) => (HOST_API[v] as Handler).idempotent === true);

// PostgREST's words for a function or column it doesn't have.
export const missingLeaseSchema = (msg: string) => /could not find the function|schema cache|does not exist|lease_until/i.test(msg);

// What outlives one pass (and, on a Mac, a module reload, inside the inbox's state).
export interface LeaseState {
  held: Set<string>;
  renewedAt: number;
  reclaimedAt: number;
  offUntil: number;
}

export const newLeaseState = (): LeaseState => ({ held: new Set(), renewedAt: 0, reclaimedAt: 0, offUntil: 0 });

export function createLeases(st: LeaseState, log: (msg: string) => void, now: () => number = Date.now) {
  function failed(err: unknown) {
    const msg = (err as Error).message;
    if (!missingLeaseSchema(msg)) {
      log(`leases: ${msg}`);
      return;
    }
    if (st.offUntil === 0) log("leases: this database has no command leases yet, so a claim is held until it's reported.");
    st.offUntil = now() + RETRY_OFF_MS;
  }
  const off = () => st.offUntil > now();

  return {
    hold: (id: string) => void st.held.add(id),
    drop: (id: string) => void st.held.delete(id),
    // Renews what this host is running, at most once a RENEW_EVERY_MS. A claim's own lease covers its first minutes.
    async renew(line: CommandLine): Promise<void> {
      if (!line.renew || !st.held.size || off() || now() - st.renewedAt < RENEW_EVERY_MS) return;
      st.renewedAt = now();
      try {
        await line.renew([...st.held].slice(0, RENEW_MAX));
      } catch (err) {
        failed(err);
      }
    },
    // Requeues this host's own expired claims of IDEMPOTENT_VERBS, at most once a RECLAIM_EVERY_MS; answers how many.
    async reclaim(line: CommandLine): Promise<number> {
      if (!line.reclaim || off() || now() - st.reclaimedAt < RECLAIM_EVERY_MS) return 0;
      st.reclaimedAt = now();
      try {
        const back = await line.reclaim(IDEMPOTENT_VERBS);
        if (back) log(`requeued ${String(back)} command${back === 1 ? "" : "s"} whose lease ran out`);
        return back;
      } catch (err) {
        failed(err);
        return 0;
      }
    },
  };
}
