// The mini-app wiring for Electron main: the data reads (electron/app-data.cjs), the hosted
// fetch / env / requestSecret (electron/app-data-fetch.cjs), and the Share dialog's "Upload
// secrets" push (electron/app-secrets-push.cjs). Plus the account-store wiring the push
// depends on. Lives in its own file so main.cjs can stay under its line cap and so the
// Touch ID + sealed-account plumbing here is its own testable unit. Mirrors the
// keep-working-ipc / server-ipc / startup-ipc pattern (one setup fn called by main.cjs).

const { createAccountStore } = require("./account-store.cjs");

// Wires the three mini-app modules plus the sealed account store. Called by main.cjs once
// `vault` is up so names/values work; the order matches main.cjs's previous inline setup
// (touchIdConfirm bound, then app-data, app-data-fetch, app-secrets-push, account store).
// getSafeStorage is a callback because Electron's safeStorage is only available after app
// whenReady (electron/account-store.cjs).
function setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink, getSafeStorage, server }) {
  if (!ipcMain) throw new Error("setupApps needs ipcMain.");
  if (!vault) throw new Error("setupApps needs the vault.");
  if (typeof ownsPane !== "function") throw new Error("setupApps needs ownsPane (pane.owns).");
  if (typeof isBoard !== "function") throw new Error("setupApps needs isBoard (board-window check).");
  if (!dataDir) throw new Error("setupApps needs dataDir.");
  if (typeof supabaseReadLink !== "function") throw new Error("setupApps needs supabaseReadLink.");
  if (typeof getSafeStorage !== "function") throw new Error("setupApps needs getSafeStorage.");
  if (typeof server !== "function") throw new Error("setupApps needs server (the local server's url and token).");

  // The app-secrets-push's Touch ID goes through the vault's own confirm: same prompt helper,
  // no separate dialog. Bound here so the closure the push captures resolves to vault.confirm
  // at call time, once a "Upload secrets" click hits.
  const confirm = (reason) => vault.confirm(reason);

  // The sealed account store the push uses to read the user's Supabase access token
  // (lib/account.ts, "weft-auth" key). The safeStorage seal is only available after app
  // whenReady, so the store is created on first use here too — same lazy pattern main.cjs
  // used to do inline.
  let accountStore;
  const account = () => {
    if (!accountStore) accountStore = createAccountStore({ dataDir, safeStorage: getSafeStorage() });
    return accountStore.read();
  };

  // And data mini apps: the env grant + reads for panes saved as apps
  // (electron/app-data.cjs, docs/architecture/mini-apps.md).
  require("./app-data.cjs").setupAppData({
    ipcMain,
    dataDir,
    vault,
    readLink: supabaseReadLink,
    owns: ownsPane,
  });

  // And the hosted mini apps' weft.fetch / weft.env / weft.requestSecret
  // (electron/app-data-fetch.cjs, docs/architecture/mini-app-hosting.md): same pane-frame
  // gate, same vault env, a different policy layer (parsePolicy) and a DNS check before the
  // call.
  require("./app-data-fetch.cjs").setupAppDataFetch({
    ipcMain,
    dataDir,
    vault,
    owns: ownsPane,
  });

  // And the Share dialog's "Upload secrets" button (electron/app-secrets-push.cjs): reads
  // the account's Supabase access token from the sealed session, asks Touch ID once, and POSTs
  // the manifest's author secrets and public names to weft.zip.
  require("./app-secrets-push.cjs").setupAppSecretsPush({
    ipcMain,
    dataDir,
    vault,
    account,
    confirm,
    isBoard,
  });

  // And the live-data bridge (electron/live-data.cjs): a file: page asks for a PATH on Weft's own
  // server and main does the GET with the launch token, so a report can show numbers that are
  // true now instead of the ones baked in when it was written. The server accessor is a callback:
  // the server may not be up yet when main wires this.
  require("./live-data.cjs").setupLiveData({
    ipcMain,
    serverUrl: () => server()?.url ?? "",
    token: () => server()?.token ?? "",
    owns: ownsPane,
  });

  return { account };
}

module.exports = { setupApps };
