// weft:// links reaching Weft: the OS registration, a link that launched it, and the events that
// carry one to the running app. The Weft account sign-in's weft://account-callback redirect comes
// back this way, as do weft://new and weft://card/….
const path = require("node:path");
const { argvLink } = require("./argv-link.cjs");

// - Packaged builds: the plain call; electron-builder's `protocols` entry covers install time too.
// - Unpackaged on Windows and Linux (`electron .`): register the dev Electron with this project
//   folder as its argument, the way Electron's deep-link guide does. Without it the OS has no
//   handler for weft:// and the browser's sign-in redirect goes nowhere.
// - Unpackaged on macOS: skip. ~/Applications/Weft Dev.app (scripts/dev-protocol.cjs) owns the
//   scheme there, and registering the bare Electron.app would take it away from the wrapper.
function registerProtocolClient({ app, protocol, platform = process.platform, argv = process.argv, execPath = process.execPath }) {
  if (app.isPackaged) return app.setAsDefaultProtocolClient(protocol);
  if (platform === "darwin" || !argv[1]) return false;
  return app.setAsDefaultProtocolClient(protocol, execPath, [path.resolve(argv[1])]);
}

// On Windows and Linux a link that launched Weft comes in its own argv; queue it until the board is up.
function launchLinks(argv, protocol) {
  const link = argvLink(argv, protocol);
  return link ? [link] : [];
}

function listenForLinks({ app, protocol, showMain, handleLink }) {
  app.on("second-instance", (_event, argv) => {
    showMain();
    // weft:// links may arrive as a raw arg (the OS or the wrapper passes them through) or as
    // `--weft-link=…` when the wrapper wants to be explicit. macOS's open-url event covers the
    // running case there; this handler is how Windows and Linux deliver them.
    const link = argvLink(argv, protocol);
    if (link) handleLink(link);
  });

  // macOS delivers weft:// links here, possibly before the app is ready.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleLink(url);
  });
}

module.exports = { registerProtocolClient, launchLinks, listenForLinks };
