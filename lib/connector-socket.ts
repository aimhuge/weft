// The worker daemon's connector socket (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): a
// Unix socket in the worker's home (mode 600) that a card's git credential helper and gh wrapper
// (scripts/weft-connector-helper.cjs) ask for that card's GitHub token. One JSON line each way. The card comes from the
// capability in the asking session's env (lib/connector-env.ts), and the repo from that card's own checkout (its
// origin), never from the caller; the token comes from lib/connector-client.ts. A card can still copy what it's
// handed: that's layer 1's accepted trade-off, and the on-box helper (P4/P5) is what closes it.
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { cardForCap } from "./connector-env";
import type { ConnectorClient } from "./connector-client";

export interface SocketDeps {
  socket: string;
  client: Pick<ConnectorClient, "get" | "forget">;
  cwdOf: (cardId: string) => string | undefined;
  repoOf?: (cwd: string) => Promise<string | null>;
  // What gh runs with, from the daemon, not the card's env: the real gh and a PATH without the wrapper.
  gh: { path: string | null; searchPath: string };
  log: (line: string) => void;
}

// owner/name from a github.com remote, https or ssh, or null.
export function repoOfRemote(url: string): string | null {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m?.[1] ?? null;
}

const originRepo = (cwd: string) =>
  new Promise<string | null>((resolve) => {
    execFile("git", ["-C", cwd, "config", "--get", "remote.origin.url"], { timeout: 5_000 }, (err, out) => resolve(err ? null : repoOfRemote(out)));
  });

type Reply = Record<string, unknown>;

export async function answer(deps: SocketDeps, raw: string): Promise<Reply> {
  let msg: { cap?: unknown; op?: unknown };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return { error: "Bad request." };
  }
  const cardId = cardForCap(msg.cap);
  if (!cardId) return { error: "This isn't a card's session on this worker, so it gets no GitHub token." };
  if (msg.op === "erase") {
    deps.client.forget(cardId);
    return { ok: true };
  }
  if (msg.op !== "get") return { error: "Ask for get or erase." };
  const cwd = deps.cwdOf(cardId);
  const repo = cwd ? await (deps.repoOf ?? originRepo)(cwd) : null;
  if (!repo) return { error: "This card's checkout has no github.com origin, so Weft can't say which repo it's for." };
  try {
    const t = await deps.client.get(cardId, repo);
    return { token: t.token, login: t.login, expiresAt: new Date(t.expiresAt).toISOString(), asks: t.asks, gh: deps.gh.path, path: deps.gh.searchPath };
  } catch (err) {
    deps.log(`Weft Worker: GitHub token for card ${cardId.slice(0, 8)} refused: ${(err as Error).message}`);
    return { error: (err as Error).message };
  }
}

export function startConnectorSocket(deps: SocketDeps): { close: () => void } {
  fs.rmSync(deps.socket, { force: true });
  const server = net.createServer((conn) => {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("error", () => conn.destroy());
    conn.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > 4_096) return void conn.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      void answer(deps, buf.slice(0, nl)).then((reply) => conn.end(`${JSON.stringify(reply)}\n`));
    });
  });
  server.listen(deps.socket, () => fs.chmodSync(deps.socket, 0o600));
  server.on("error", (err) => deps.log(`Weft Worker: connector socket: ${err.message}`));
  return {
    close: () => {
      server.close();
      fs.rmSync(deps.socket, { force: true });
    },
  };
}
