// Who a host is to cloud_commands, and so how it reads, claims and reports a command (docs/architecture/project-hosts.md#devices-and-records).
// A Mac acts under the account's session: it reads its device's rows through RLS, claims with a conditional update and
// reports through the update-own grant. A Weft Worker has no session, only its key: worker_pending, worker_claim and
// worker_report, each checking the key. The inbox (lib/host/inbox.ts) runs either one the same way.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudCommandRow } from "../cloud-commands";
import { hostFailure, isHostDone, type HostDone, type HostResult } from "../host-command";
import type { Registry } from "../worker-registry";

const ERROR_MAX = 300;
const BATCH = 20;

// What a command came to: the card it made or touched, and a host command's result.
export type Failed = { status: "failed"; error: string; result?: HostResult };
export type Outcome = { status: "done"; cardId: string | null; result?: HostResult } | Failed;

// What a kind's handler returns: the card, nothing (a sign-in), or a host verb's card and result.
export type Done = string | null | HostDone;

export const doneOutcome = (done: Done): Outcome => (isHostDone(done) ? { status: "done", cardId: done.cardId, result: done.result } : { status: "done", cardId: done });

// A failure's message, cut to fit the row. A host command's result says it failed too, so a board waiting on `result`
// reads one place; the other kinds leave the column alone.
export function failedOutcome(command: CloudCommandRow, err: unknown): Failed {
  const error = (err as Error).message.slice(0, ERROR_MAX);
  return command.kind === "host" ? { status: "failed", error, result: hostFailure(error) } : { status: "failed", error };
}

// The three calls a host makes on cloud_commands, bound to its identity.
export interface CommandLine {
  pending(): Promise<CloudCommandRow[]>;
  // True when this host now holds the command. Only a pending row can be claimed, so a command runs once.
  claim(id: string): Promise<boolean>;
  report(id: string, outcome: Outcome): Promise<void>;
}

// The Mac: the account signed in here, its device's pending rows oldest first. A claim that errors is a claim it
// didn't get, and a report that fails is only logged: the row stays claimed, never run twice.
export function sessionLine(client: SupabaseClient, uid: string, device: string, warn: (msg: string) => void): CommandLine {
  const commands = () => client.from("cloud_commands");
  return {
    async pending() {
      const { data, error } = await commands()
        .select("*")
        .eq("target_device", device)
        .eq("created_by", uid)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(BATCH)
        .overrideTypes<CloudCommandRow[]>();
      if (error) throw new Error(error.message);
      return data;
    },
    async claim(id) {
      const claim = await commands().update({ status: "claimed" }).eq("id", id).eq("status", "pending").select("id");
      return !claim.error && claim.data.length > 0;
    },
    async report(id, o) {
      const result = o.result ? { result: o.result } : {};
      const patch = o.status === "done" ? { status: o.status, card_id: o.cardId, ...result } : { status: o.status, error: o.error, ...result };
      const { error } = await commands().update(patch).eq("id", id);
      if (error) warn(`couldn't report on ${id}: ${error.message}`);
    },
  };
}

// A Weft Worker: its key, through the key-checked functions. A failed claim throws (the pass logs it); a report goes
// without p_result unless there is one, so it still reaches a database whose worker_report predates it.
export function keyLine(reg: Pick<Registry, "pending" | "claim" | "report">): CommandLine {
  return {
    pending: () => reg.pending(),
    claim: (id) => reg.claim(id),
    async report(id, o) {
      const cardId = o.status === "done" ? o.cardId : null;
      const error = o.status === "failed" ? o.error : null;
      if (o.result) await reg.report(id, o.status, cardId, error, o.result);
      else await reg.report(id, o.status, cardId, error);
    },
  };
}
