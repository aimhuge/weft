// Starts a Weft Worker's GitHub connector (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// the client that asks weft.zip for tokens, signed with the box's pairing key; the socket a card's git and gh reach it
// through; and the setup every CLI session's env is given (lib/connector-env.ts). A token-enrolled box has no pairing
// key, so it gets none of this, and its cards keep using `github_login` as before.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { connectorClient } from "./connector-client";
import { setConnectorSetup } from "./connector-env";
import { startConnectorSocket } from "./connector-socket";
import { SITE } from "./site";

export interface WorkerConnectorDeps {
  home: string;
  workerId: string;
  key: string;
  sign: ((message: string) => string) | undefined;
  // Weft's clone, where scripts/ lives.
  weftDir: string;
  cwdOf: (cardId: string) => string | undefined;
  log: (line: string) => void;
  site?: string;
  run?: (cmd: string, args: string[]) => string;
}

const runSync = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });

const lines = (run: NonNullable<WorkerConnectorDeps["run"]>, cmd: string, args: string[]) => {
  try {
    return run(cmd, args).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

export function startWorkerConnectors(deps: WorkerConnectorDeps): { close: () => void } | null {
  if (!deps.sign) {
    deps.log("Weft Worker: enrolled by token, so no GitHub connector (pair it from Settings → Devices to use one).");
    return null;
  }
  const run = deps.run ?? runSync;
  const binDir = path.join(deps.weftDir, "scripts", "worker-bin");
  // The PATH gh runs with, and the real gh on it: the daemon's own, without the wrapper's folder.
  const searchPath = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d && d !== binDir).join(path.delimiter);
  const gh = lines(run, "/usr/bin/env", ["PATH=" + searchPath, "which", "gh"])[0] ?? null;
  const boxHelpers = lines(run, "git", ["config", "--global", "--get-all", "credential.https://github.com.helper"]);
  const client = connectorClient({ site: deps.site ?? SITE, key: deps.key, workerId: deps.workerId, sign: deps.sign, nonce: () => randomBytes(32).toString("hex"), fetch, now: Date.now });
  const socket = path.join(deps.home, "connector.sock");
  setConnectorSetup({ socket, node: process.execPath, helper: path.join(deps.weftDir, "scripts", "weft-connector-helper.cjs"), binDir, boxHelpers });
  const server = startConnectorSocket({ socket, client, cwdOf: deps.cwdOf, gh: { path: gh, searchPath }, log: deps.log });
  return {
    close: () => {
      server.close();
      client.clear();
      setConnectorSetup(null);
    },
  };
}
