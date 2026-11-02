// Main's copy of lib/connector-wire.ts (a connector token on a Weft Worker): the connectors, the seal purpose and the
// message main signs. Held to the TS side by a test.
const CONNECTORS = {
  gog: { bin: "gog", env: "GOG_ACCESS_TOKEN", accountEnv: "GOG_ACCOUNT", label: "Google Workspace (gog)" },
  gh: { bin: "gh", env: "GH_TOKEN", label: "GitHub (gh)" },
};

const isConnector = (v) => typeof v === "string" && Object.hasOwn(CONNECTORS, v);
const connectorPurpose = (connector, nonce) => `connector:${connector}:${nonce}`;

/** @param {string} op @param {string} connector @param {string} nonce @param {number} issuedAt @param {{ epk: string, iv: string, ct: string, tag: string } | null} [sealed] */
function connectorMessage(op, connector, nonce, issuedAt, sealed) {
  return ["weft-connector-v1", op, connector, nonce, String(issuedAt), sealed?.epk ?? "", sealed?.iv ?? "", sealed?.ct ?? "", sealed?.tag ?? ""].join("\n");
}

module.exports = { CONNECTORS, isConnector, connectorPurpose, connectorMessage };
