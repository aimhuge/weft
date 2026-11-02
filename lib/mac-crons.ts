// This Mac's crons, published for the threads on the user's Weft Workers (docs/architecture/crons.md#on-a-weft-worker).
// A worker thread's list_crons lists them read-only beside the worker's own (lib/worker-mac-crons.ts). What goes is a
// summary: the name, schedule, fork or fresh, on or off, next run and project name, and the prompt only when it's short.
// Never the folder's full path, the source card, the fork's session or the runs. Written to cloud_mac_crons with the
// account's own session (owner-only), a moment after any `crons` event, and every 10 minutes in case the sign-in
// changed; signed out, or a database without the table yet, it publishes nothing.
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { subscribe } from "./bus";
import { listCrons } from "./cron-store";
import type { Cron, CronMode } from "./cron-types";
import { deviceId } from "./device-id";

export const MAC_PROMPT_MAX = 120;
export const MAC_CRON_CAP = 200;
export const PUBLISH_DELAY_MS = 2_000;
export const REPUBLISH_MS = 10 * 60_000;

export interface MacCronRow {
  id: string;
  name: string;
  expr: string;
  mode: CronMode;
  enabled: boolean;
  folder: string;
  nextAt?: number;
  prompt?: string;
}

export function macCronRow(c: Cron): MacCronRow {
  const row: MacCronRow = { id: c.id, name: c.name, expr: c.expr, mode: c.mode, enabled: c.enabled, folder: path.basename(c.cwd) };
  if (c.nextAt !== undefined) row.nextAt = c.nextAt;
  if (c.prompt.length <= MAC_PROMPT_MAX) row.prompt = c.prompt;
  return row;
}

// This Mac's own crons only: a worker's (they carry `worker`) are that worker's to list.
export const macCronRows = (crons: Cron[]): MacCronRow[] => crons.filter((c) => !c.worker).slice(0, MAC_CRON_CAP).map(macCronRow);

// Upserts this Mac's row; false when there's no session to write it with.
export async function putMacCrons(rows: MacCronRow[], client: SupabaseClient = accountClient(), device = deviceId(), label = os.hostname()): Promise<boolean> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return false;
  const row = { owner_user: uid, device, label: label.slice(0, 100), crons: rows, updated_at: new Date().toISOString() };
  const { error } = await client.from("cloud_mac_crons").upsert(row, { onConflict: "owner_user,device" });
  if (error) throw new Error(error.message);
  return true;
}

export interface MacCronsDeps {
  read: () => Cron[];
  put: (rows: MacCronRow[]) => Promise<unknown>;
  log?: (msg: string) => void;
  delayMs?: number;
}

// poke() after any change: the list goes once, delayMs later, however many changes came in between. A failure is
// logged once until a publish works again, so a database without the table doesn't fill the log.
export function createMacCronsPublisher({ read, put, log = console.warn, delayMs = PUBLISH_DELAY_MS }: MacCronsDeps) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failing = false;
  async function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      await put(macCronRows(read()));
      failing = false;
    } catch (err) {
      if (!failing) log(`[weft] couldn't publish this Mac's crons for your workers: ${(err as Error).message}`);
      failing = true;
    }
  }
  return {
    poke() {
      timer ??= setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}

// Once per server process, from the board's prewarm (lib/copilot.ts). Answers the way to stop it.
export function startMacCronsPublish(deps: Partial<MacCronsDeps> = {}, every = REPUBLISH_MS): () => void {
  const publisher = createMacCronsPublisher({ read: listCrons, put: (rows) => putMacCrons(rows), ...deps });
  const off = subscribe((event) => {
    if (event.type === "crons") publisher.poke();
  });
  void publisher.flush();
  const tick = setInterval(() => void publisher.flush(), every);
  tick.unref();
  return () => {
    off();
    clearInterval(tick);
  };
}
