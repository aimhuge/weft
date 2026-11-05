// mcp__webhooks__relay: a webhook's signing secret (in the vault) into the columns the deployed relay verifies with
// (lib/webhook-relay.ts, docs/architecture/webhooks.md). Touch ID every time (vault.sendValue, or vault.sendValues
// for several webhooks under one approval); the plaintext never crosses IPC or the Next server, so even a thread
// driving the createRelay flow can't read it or get a relay row sealed with a secret it chose (pentest 2026-10-20,
// F-12). Each returns just the hex trio the server hands to Supabase.
const { relayKeyFromEnv, sealSecret, sealedToHex } = require("./relay-secret.cjs");

// Same allowlist the deployed relay uses (lib/webhook-signatures.ts PROVIDERS). Kept inline so this CommonJS file
// doesn't need to compile a TS module just for a check.
const PROVIDERS = ["stripe", "github", "vercel", "svix"];
const MAX_HOOKS = 20;

function checkProvider(provider) {
  if (!PROVIDERS.includes(String(provider || ""))) throw new Error("Unknown provider.");
}

function relayKey() {
  const key = relayKeyFromEnv();
  if (!key) throw new Error("Relay signing key is not configured on this Mac; set WEFT_RELAY_SECRET_KEY.");
  return key;
}

// The hooks of one batch, checked: a known provider each, a secret name each, no more than MAX_HOOKS.
function cleanHooks(hooks) {
  if (!Array.isArray(hooks) || !hooks.length) throw new Error("Name at least one webhook to seal.");
  if (hooks.length > MAX_HOOKS) throw new Error(`At most ${MAX_HOOKS} webhooks in one call.`);
  return hooks.map((h) => {
    checkProvider(h?.provider);
    const name = String(h.name ?? "").trim();
    if (!name) throw new Error("Every webhook needs its signing secret's vault name.");
    return { name, provider: String(h.provider) };
  });
}

/**
 * @param {() => any} vault
 * @param {(worker: unknown, workerName: unknown) => string} [onWorker] " on <worker>" for a Weft Worker's ask
 *   (lib/device-call-approvals.ts), nothing for this Mac's own.
 */
function relaySealRoutes(vault, onWorker = () => "") {
  return {
    "POST /webhooks/relay-seal": ({ folder, name, environment, provider, worker, workerName }) => {
      const env = String(environment || "development");
      checkProvider(provider);
      const key = relayKey();
      return vault().sendValue(
        String(folder),
        String(name),
        env,
        (label) => `seal the ${provider} signing secret ${name} (${label}, ${env}) and store it on the relay${onWorker(worker, workerName)}`,
        (value) => sealedToHex(sealSecret(value, key)),
      );
    },
    // Several webhooks of one folder at once: one Touch ID naming every secret. Every name needs a value, or nothing
    // is asked or sealed (missing lists them). The answer is { sealed: { NAME: trio } }, one trio per secret name.
    "POST /webhooks/relay-seal-many": ({ folder, environment, hooks, worker, workerName }) => {
      const env = String(environment || "development");
      const list = cleanHooks(hooks);
      const key = relayKey();
      const names = [...new Set(list.map((h) => h.name))];
      const what = list.map((h) => `${h.provider} ${h.name}`).join(", ");
      return vault().sendValues(
        String(folder),
        names,
        env,
        (label) => `seal ${list.length} webhook signing secrets (${label}, ${env}) and store them on the relay${onWorker(worker, workerName)}: ${what}`,
        (values) => ({ sealed: Object.fromEntries(names.map((n) => [n, sealedToHex(sealSecret(values[n], key))])) }),
      );
    },
  };
}

module.exports = { relaySealRoutes, MAX_HOOKS };
