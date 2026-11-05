// The local server's address and launch token, as one accessor.
//
// Two modules need it: the live-data bridge (electron/live-data.cjs), which lets a `file:` page
// read a JSON snapshot off Weft's own server, and the provider drawers (electron/providers.cjs),
// which ask Vercel and friends about the deployment. Both want the same thing — the url and the
// token the desktop app holds — and both want it read fresh, because the server may not be up yet
// when main wires them.
//
// Lives in its own file so main.cjs doesn't grow a line for a closure it only passes along.

/**
 * Builds the accessor from the pieces main has: the running server (or null) and the launch token.
 *
 * @param {() => { url: string } | null} getServer the running server, read fresh on each call
 * @param {string} token the launch token
 * @returns {() => { url: string; token: string } | null} the accessor
 */
function serverInfo(getServer, token) {
  return () => {
    const s = getServer();
    return s ? { url: s.url, token } : null;
  };
}

module.exports = { serverInfo };
