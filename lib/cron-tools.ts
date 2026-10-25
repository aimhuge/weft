import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { describeCron } from "./cron-schedule";
import { listCrons } from "./cron-store";
import type { Cron } from "./cron-types";
import { createCron, deleteCron, updateCron } from "./crons";
import { getCard } from "./store";

// The board MCP's cron tools (docs/architecture/crons.md): a thread can put itself, or a fresh prompt, on a
// schedule. A cron a thread makes runs right away, like create_card; the rail's Crons drawer marks it.

async function attempt(run: () => string | Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await run() }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

function when(at?: number): string {
  return at === undefined ? "no next run" : `next ${new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

export function cronLine(cron: Cron): string {
  const last = cron.runs[cron.runs.length - 1];
  const lastRun = last ? (last.error ? ` | last run failed: ${last.error}` : ` | last run ${last.n}: card ${last.cardId}`) : "";
  return `${cron.id} | ${cron.name} | ${describeCron(cron.expr)} (${cron.expr}) | ${cron.mode} | ${cron.enabled ? "on" : "off"} | ${when(cron.nextAt)}${lastRun}`;
}

const SCHEDULE = z.string().describe('Five-field cron in the Mac\'s local time, e.g. "0 9 * * 1-5" for weekdays at 9:00');

export function cronTools(getCardId: () => string | undefined) {
  return [
    tool(
      "create_cron",
      "Run a thread again on a schedule. Each run is a new card: by default a fork of this thread from its latest message, with the prompt sent as the new turn; mode fresh starts a new thread with the prompt only. Make the prompt say exactly what each run should do.",
      {
        prompt: z.string(),
        schedule: SCHEDULE,
        name: z.string().optional(),
        mode: z.enum(["fork", "fresh"]).optional().describe("fork (default when called from a thread) or fresh"),
        card_id: z.string().optional().describe("The card to fork or take the folder from; defaults to this thread"),
        folder: z.string().optional().describe("Project folder for a fresh cron with no card"),
      },
      ({ prompt, schedule, name, mode, card_id, folder }) =>
        attempt(() => {
          const cardId = card_id ?? getCardId();
          const card = cardId ? getCard(cardId) : undefined;
          const cron = createCron({ prompt, expr: schedule, name, mode, cardId: card && card.role !== "copilot" ? card.id : undefined, cwd: folder, by: "thread" });
          return `Created cron ${cron.id}: ${cron.name}, ${describeCron(cron.expr)}, ${when(cron.nextAt)}`;
        }),
    ),
    tool("list_crons", "List the board's crons: id | name | schedule | mode | on/off | next run | last run.", {}, () =>
      attempt(() => listCrons().map(cronLine).join("\n") || "No crons yet."),
    ),
    tool(
      "update_cron",
      "Change a cron's prompt, schedule, name or mode, or turn it on or off.",
      { id: z.string(), prompt: z.string().optional(), schedule: SCHEDULE.optional(), name: z.string().optional(), mode: z.enum(["fork", "fresh"]).optional(), enabled: z.boolean().optional() },
      ({ id, schedule, ...rest }) => attempt(() => cronLine(updateCron(id, { ...rest, ...(schedule !== undefined ? { expr: schedule } : {}) }))),
    ),
    tool("delete_cron", "Delete a cron. Its past run cards stay on the board.", { id: z.string() }, ({ id }) =>
      attempt(() => {
        deleteCron(id);
        return `Deleted cron ${id}.`;
      }),
    ),
    tool("run_cron_now", "Fire one run of a cron right away, outside its schedule, to test it.", { id: z.string() }, ({ id }) =>
      attempt(async () => {
        // Loaded when used: ./cron-run reaches the runner, which builds these tools (a circular import at load).
        const { runCron } = await import("./cron-run");
        const card = await runCron(id);
        return `Started run ${card.cronRun} as card ${card.id}: ${card.title}`;
      }),
    ),
  ];
}

