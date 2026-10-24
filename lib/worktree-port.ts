import net from "node:net";
import { namedPort } from "./dev-commands";
import { globalSingleton } from "./global-singleton";
import type { Card } from "./types";

// An isolated card's dev server runs from its worktree, so it would fight the main tree's server for the same port
// (3000, mostly). It gets PORT set to a free port of its own instead, the same one for the card's whole life, unless
// its command names one (`pnpm dev -p 4001`). Frameworks that ignore PORT (Vite) need `--port` in the command.

const ports = globalSingleton("__weftIsolatedPorts", () => new Map<string, number>());

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

// The port an isolated card's dev command gets as PORT; undefined for a shared card or a command with its own port.
export async function isolatedPort(card: Pick<Card, "id" | "worktree"> | undefined, command: string): Promise<number | undefined> {
  if (!card?.worktree || namedPort(command)) return undefined;
  const known = ports.get(card.id);
  if (known) return known;
  const port = await freePort();
  ports.set(card.id, port);
  return port;
}

// A local url moved to the card's port ("http://localhost:3000/x" -> "http://localhost:51234/x"); others unchanged.
export function withPort(url: string | undefined, port: number | undefined): string | undefined {
  if (!url || !port) return url;
  try {
    const u = new URL(url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return url;
    u.port = String(port);
    return u.toString();
  } catch {
    return url;
  }
}
