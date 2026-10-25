// The rail's providers whose setup is one call each, moved out of main.cjs to keep it under its size cap: BlastCP,
// Cloudflare, Slack and Goose. Each keeps its secret in the Keychain and answers the board window only; this just
// starts them and hands back the APIs main's control-server routes need (electron/pane-routes.cjs).

// board() is the board window's webContents; server() is the Next server's { url, token }, or null before it's up.
function setupProviders({ ipcMain, dataDir, board, server }) {
  // BlastCP: its sign-in is in the Keychain too, and which property a folder posts as is in the data folder.
  const blastcpApi = require("./blastcp.cjs").setupBlastcp({ ipcMain, dataDir, board });
  // Cloudflare: its token is in the Keychain and which Worker or Pages project a folder is is in the data folder.
  require("./cloudflare.cjs").setupCloudflare({ ipcMain, dataDir, board });
  // Slack: its bot and app tokens are in the Keychain; `/weft` and @mentions come in over Socket Mode, to the server.
  const slackApi = require("./slack.cjs").setupSlack({ ipcMain, dataDir, board, server });
  // Goose: a provider key per provider, in the Keychain; the board never reads one back (electron/goose-ipc.cjs).
  const { goose: gooseApi } = require("./goose-ipc.cjs").setupGoose({ ipcMain, dataDir, board });
  return { blastcpApi, slackApi, gooseApi };
}

module.exports = { setupProviders };
