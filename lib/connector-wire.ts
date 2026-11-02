// The wire of a connector token on a Weft Worker (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// Settings → Devices turns a connector on for one worker; the owner's Mac then mints a short-lived token from its own
// sign-in and sends it as a `connector` command: sealed to the worker's pinned box key for this connector and nonce, and
// signed with the Mac's device key over everything in it, so the worker takes it only from the Mac it was paired with.
// electron/connector-wire.cjs is main's copy, held to this by a test.
import type { Sealed } from "./worker-seal";

export const CONNECTOR_KIND = "connector";

export interface ConnectorSpec {
  // The CLI threads run, which the worker's shim stands in for.
  bin: string;
  // The variable the CLI reads its token from.
  env: string;
  // Where the account goes, when the CLI wants it named.
  accountEnv?: string;
  label: string;
}

export type ConnectorId = "gog" | "gh";

export const CONNECTORS: Record<ConnectorId, ConnectorSpec> = {
  gog: { bin: "gog", env: "GOG_ACCESS_TOKEN", accountEnv: "GOG_ACCOUNT", label: "Google Workspace (gog)" },
  gh: { bin: "gh", env: "GH_TOKEN", label: "GitHub (gh)" },
};

export const isConnector = (v: unknown): v is ConnectorId => typeof v === "string" && Object.hasOwn(CONNECTORS, v);

// What the token is sealed for in transit, and for at rest on the worker.
export const connectorPurpose = (connector: string, nonce: string) => `connector:${connector}:${nonce}`;
export const connectorStorePurpose = (connector: string) => `connector-store:${connector}`;

// What the Mac signs: the op, the connector, the nonce, when it was issued and the sealed bytes (none for a forget).
export function connectorMessage(op: string, connector: string, nonce: string, issuedAt: number, sealed?: Sealed | null): string {
  return ["weft-connector-v1", op, connector, nonce, String(issuedAt), sealed?.epk ?? "", sealed?.iv ?? "", sealed?.ct ?? "", sealed?.tag ?? ""].join("\n");
}

// The sealed plaintext.
export interface ConnectorToken {
  v: 1;
  connector: string;
  account: string;
  token: string;
  expiresAt: number;
  issuedAt: number;
}
