// The user's Mac crons as a thread on a Weft Worker sees them (docs/architecture/crons.md#on-a-weft-worker): read-only
// lines after the worker's own in list_crons, from what each Mac publishes (lib/mac-crons.ts, worker_mac_crons). Each id
// is `mac:<id>`, so update_cron, delete_cron and run_cron_now can tell one apart and refuse it: a worker thread is the
// less-trusted side (its key is a box's, its prompt can be injected), so a Mac's cron changes only on the Mac.
import { describeCron } from "./cron-schedule";
import type { MacCronRow } from "./mac-crons";
import type { BoardLink } from "./worker-board-link";
import type { MacCronsRow } from "./worker-registry";

export const MAC_CRON = "mac:";

export const isMacCronId = (id: unknown): boolean => typeof id === "string" && id.startsWith(MAC_CRON);

export const MAC_CRON_REFUSED =
  "That cron is on the user's Mac, and this thread runs on a Weft Worker, so it can only read it. Ask the user to change it in the Mac's ⏰ drawer, or from a thread on the Mac.";

export const MAC_CRONS_NOTE = "Crons on the user's Mac, read-only from here (change them in the Mac's ⏰ drawer or from a thread there):";

const str = (v: unknown) => (typeof v === "string" ? v : "");

function when(at: unknown): string {
  return typeof at === "number" ? `next ${new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "no next run";
}

// One cron as list_crons draws it, with the Mac it's on and the prompt when the Mac sent it.
export function macCronLine(c: Partial<MacCronRow>, mac: string): string {
  const prompt = c.prompt ? ` | “${c.prompt}”` : "";
  return `${MAC_CRON}${str(c.id)} | ${str(c.name)} | ${describeCron(str(c.expr))} (${str(c.expr)}) | ${str(c.mode)} | ${c.enabled ? "on" : "off"} | ${when(c.nextAt)} | ${str(c.folder)} on ${mac}${prompt}`;
}

export function macCronsText(rows: MacCronsRow[]): string {
  const lines = rows.flatMap((r) => r.crons.filter((c): c is Partial<MacCronRow> => Boolean(c) && typeof c === "object").map((c) => macCronLine(c, r.label || "a Mac")));
  return lines.length ? `${MAC_CRONS_NOTE}\n${lines.join("\n")}` : "No crons on the user's Mac.";
}

// What list_crons adds: the Mac crons, or why they couldn't be read. Never throws: the worker's own list still shows.
export async function macCronsSection(link: Pick<BoardLink, "macCrons">): Promise<string> {
  if (!link.macCrons) return "This worker can't read the Mac's crons yet. Update it with weft-worker update.";
  try {
    return macCronsText(await link.macCrons());
  } catch (err) {
    return `Couldn't read the Mac's crons: ${(err as Error).message}`;
  }
}
