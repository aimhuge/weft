import path from "node:path";
import { listDev } from "./devserver-list";
import { tunnelFor } from "./tunnels";

// A worker's dev servers on its row, for the board's Services drawer (docs/architecture/dev-servers.md#on-a-worker).
// The board can't reach the worker's localhost, so each row carries the private /t/<id> address when a tunnel to that
// server is open, and the drawer's Open asks for one (the `dev.open` verb) when none is. Published only on a change.

export interface WorkerDevServer {
  cardId: string;
  // The checkout's folder name, which is the project's name on the board.
  folder: string;
  command: string;
  url?: string;
  state: string;
  startedAt: number;
  source: "weft" | "thread";
  address?: string;
}

// The row is plain jsonb every member of the workspace can read, so it carries no card title (a card travels sealed)
// and no inline env value: `TOKEN=abc pnpm dev` goes up as `TOKEN=… pnpm dev`.
export const redactCommand = (command: string) => command.replace(/(^|\s)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, "$1$2=…").slice(0, 200);

// The cloud_workers column is capped at 16 KB: a few dozen rows fit with room to spare.
const MAX_SERVERS = 20;

export async function devServersNow(list = listDev, tunnel = tunnelFor): Promise<WorkerDevServer[]> {
  return (await list()).slice(0, MAX_SERVERS).map((e) => {
    const address = e.url ? tunnel(e.url)?.address : undefined;
    return {
      cardId: e.cardId,
      folder: path.basename(e.cwd),
      command: redactCommand(e.command),
      ...(e.url && { url: e.url }),
      state: e.state,
      startedAt: e.startedAt,
      source: e.source,
      ...(address && { address }),
    };
  });
}

// What the daemon calls on a timer: reads the list and puts it on the row when it differs from the last one put.
export function createDevPublisher(put: (servers: WorkerDevServer[]) => Promise<unknown>, read: () => Promise<WorkerDevServer[]> = () => devServersNow(), log: (msg: string) => void = console.warn) {
  let last: string | null = null;
  return async function publish() {
    try {
      const now = await read();
      const json = JSON.stringify(now);
      if (json === last) return;
      await put(now);
      last = json;
    } catch (err) {
      log(`Weft Worker: publishing dev servers: ${(err as Error).message}`);
    }
  };
}
