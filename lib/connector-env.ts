// How a worker card's git and gh find the daemon's connector socket (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built).
// Each CLI session gets a random capability in its env when it starts (a warm spare too, before it has a card): the
// socket maps it back to the session's card at the moment of asking, so a spare that becomes a card asks as that card.
// Git gets Weft's credential helper first for https://github.com (the box's own helpers after it, so a pasted
// `github_login` token still works when GitHub isn't turned on), and gh is the wrapper in scripts/worker-bin. No token is
// ever in this env: only the socket's path and the capability.
import { randomBytes } from "node:crypto";
import path from "node:path";

export interface ConnectorSetup {
  socket: string;
  // The node that runs scripts/weft-connector-helper.cjs, and the helper itself.
  node: string;
  helper: string;
  // The folder holding the gh wrapper, put first on a card's PATH.
  binDir: string;
  // The box's own credential helpers for https://github.com, read once at start (git config --global --get-all).
  boxHelpers: string[];
}

const caps = new Map<string, () => string | undefined>();
export const MAX_CAPS = 2_000;
let setup: ConnectorSetup | null = null;

export function setConnectorSetup(next: ConnectorSetup | null) {
  setup = next;
  if (!next) caps.clear();
}

// The card a capability belongs to now, or undefined (unknown, or a spare with no card yet).
export const cardForCap = (cap: unknown) => (typeof cap === "string" ? caps.get(cap)?.() : undefined);

const KEY = "credential.https://github.com.helper";
const quote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

// The helper line git runs: with NODE_OPTIONS and NODE_PATH cleared, so a card's own value doesn't load code into it.
export const helperCommand = (s: Pick<ConnectorSetup, "node" | "helper">) => `!/usr/bin/env -u NODE_OPTIONS -u NODE_PATH ${quote(s.node)} ${quote(s.helper)} git-credential`;

// A CLI session's env with the connector added, or the env as it was on a box with no connector socket (a Mac).
export function withConnectorEnv(env: Record<string, string | undefined>, cardId: () => string | undefined): Record<string, string | undefined> {
  if (!setup) return env;
  const cap = randomBytes(24).toString("hex");
  caps.set(cap, cardId);
  // Sessions come and go for days: the oldest capability goes first, long after its session ended.
  if (caps.size > MAX_CAPS) caps.delete(caps.keys().next().value as string);
  const base = Number(env.GIT_CONFIG_COUNT) || 0;
  const entries: [string, string][] = [[KEY, ""], [KEY, helperCommand(setup)], ...setup.boxHelpers.map((h): [string, string] => [KEY, h])];
  const git: Record<string, string> = { GIT_CONFIG_COUNT: String(base + entries.length) };
  entries.forEach(([k, v], i) => {
    git[`GIT_CONFIG_KEY_${base + i}`] = k;
    git[`GIT_CONFIG_VALUE_${base + i}`] = v;
  });
  return {
    ...env,
    ...git,
    WEFT_CONNECTOR_SOCKET: setup.socket,
    WEFT_CONNECTOR_CAP: cap,
    WEFT_CONNECTOR_NODE: setup.node,
    WEFT_CONNECTOR_HELPER: setup.helper,
    PATH: [setup.binDir, env.PATH].filter(Boolean).join(path.delimiter),
  };
}
