// The browser pane's control-server routes (electron/control-server.cjs): what threads and Weft's server ask
// Electron main for. main.cjs passes getters, since the vault, Vercel and Supabase are set up after the pane.
const { createBoardView, boardViewRoutes } = require("./board-view.cjs");
const { createFolderAccess } = require("./folder-access.cjs");
const { accountRoutesFor } = require("./account-store.cjs");
const { vaultRoutes } = require("./vault-routes.cjs");
const { envRoutes } = require("./vercel-env.cjs");
const { restartFor } = require("./restart-when-idle.cjs");
const { relayKeyFromEnv, sealSecret, sealedToHex } = require("./relay-secret.cjs");
const { sharedSnapshot, snapshotRoutes } = require("./page-snapshot.cjs");
const { gooseRoutes } = require("./goose-ipc.cjs");
const { appSecretsRoutes } = require("./app-secrets-push.cjs");
const { slackRoutes } = require("./slack.cjs");
const { touchIdPrompt } = require("./touch-id.cjs");

// The copilot's chips (lib/copilot-sources.ts): a linked service's state per folder, read-only.
function statusRoute(api) {
  return ({ folders }) => api()?.status((folders ?? []).map(String)) ?? { folders: [] };
}

function paneRoutes({ dataDir, app, dialog, systemPreferences = require("electron").systemPreferences, shell, window, board, sendMenu, updater, vault, vercelEnv, vercelApi, supabaseApi, blastcpApi = () => null, gooseApi = () => null, slackApi = () => null, cardFor = () => "" }) {
  return {
    // The Weft account's session, sealed by safeStorage; the server reads it here instead of a plain file.
    ...accountRoutesFor(dataDir),
    // mcp__secrets__add_blank, ask_add and set_value: blanks into the card's vault (a fill or run that found a key
    // missing goes through ask-add too), and a value a thread generated into one.
    ...vaultRoutes(vault, cardFor),
    // A new mini-app link's keys, pushed in the request that makes it (lib/app-share-keys.ts).
    ...appSecretsRoutes(),
    // mcp__board__request_folder_access: a thread that got "Operation not permitted" on Downloads asks;
    // macOS prompts, or a dialog opens Settings.
    "POST /folder-access/ask": ({ folder }) => createFolderAccess({ app, dialog, shell, window }).ask(folder),
    // The server's restart when idle, once nothing runs.
    "POST /app/restart": ({ then }) => restartFor({ then, updater: updater(), app }),
    // mcp__webhooks__ask_add: the board opens 🪝 on a recorded webhook.
    "POST /webhooks/ask-add": ({ folder, id }) => {
      sendMenu("add-webhook", JSON.stringify({ folder, id }));
      return { ok: true };
    },
    // mcp__webhooks__relay: a webhook's signing secret (in the vault) into the columns the deployed
    // relay verifies with (lib/webhook-relay.ts). Touch ID every time (vault.sendValue); the plaintext
    // never crosses IPC or the Next server, so even a thread driving the createRelay flow can't read it
    // or get a relay row sealed with a secret it chose (pentest 2026-10-20, F-12). Returns just the hex
    // trio the server hands to Supabase.
    "POST /webhooks/relay-seal": ({ folder, name, environment, provider }) => {
      const env = String(environment || "development");
      // Same allowlist the deployed relay uses (lib/webhook-signatures.ts PROVIDERS). Kept inline so
      // this CommonJS file doesn't need to compile a TS module just for a check.
      if (!["stripe", "github", "vercel", "svix"].includes(String(provider || ""))) throw new Error("Unknown provider.");
      const key = relayKeyFromEnv();
      if (!key) throw new Error("Relay signing key is not configured on this Mac; set WEFT_RELAY_SECRET_KEY.");
      return vault().sendValue(
        String(folder),
        String(name),
        env,
        (label) => `seal the ${provider} signing secret ${name} (${label}, ${env}) and store it on the relay`,
        (value) => sealedToHex(sealSecret(value, key)),
      );
    },
    // Opening a tunnel puts a local port on the internet, so a person says yes each time, a thread's call included
    // (lib/tunnels.ts). Cancelled means no tunnel; only the answer goes back.
    "POST /tunnels/approve": async ({ folder, target, hours }) => {
      const ask = touchIdPrompt({ systemPreferences, dialog, window });
      return { approved: await ask(`open a private tunnel to ${target} from ${folder} for ${hours} hours`) };
    },
    // mcp__secrets__push_to_vercel: a vault value onto the card's linked Vercel project, after Touch ID.
    ...envRoutes(vercelEnv),
    // The latest deploy and the unapplied migrations, per folder.
    "POST /vercel/status": statusRoute(vercelApi),
    "POST /supabase/status": statusRoute(supabaseApi),
    // Goose's provider key for a subprocess: a one-time grant, then electron/goose-env.cjs claims it and starts
    // Goose with the key in its env. The plaintext never crosses the control server (lib/goose-provider.ts).
    ...gooseRoutes(gooseApi),
    // Connecting BlastCP with your Weft account (lib/blastcp-auto.ts): the account's access token in, swapped by
    // main for a BlastCP sign-in it keeps in the Keychain. Only the outcome goes back.
    "POST /blastcp/connect-weft": ({ subjectToken, force }) => {
      const blastcp = blastcpApi();
      if (!blastcp) throw new Error("BlastCP isn't set up in this Weft yet. Restart Weft.");
      return blastcp.connectWeft(String(subjectToken ?? ""), { force: force === true });
    },
    // A mini app's link-preview screenshot (lib/app-preview-capture.ts): the page in a hidden window at 1200×630.
    ...snapshotRoutes(sharedSnapshot),
    // The server asks main to post to Slack, and how the socket is doing (electron/slack.cjs).
    ...slackRoutes(slackApi),
    // mcp__board_view__*: threads see and drive the board itself, secrets redacted (electron/board-view.cjs).
    ...boardViewRoutes(createBoardView({ board })),
  };
}

module.exports = { paneRoutes, statusRoute };
