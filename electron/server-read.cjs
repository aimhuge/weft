// Main's own reads of the local server (the dock badge and tray, Keep Working, the updater's running count).
// Main's fetch doesn't go through the board window's session, so the launch token swap (electron/api-token.cjs)
// never touches it; "1" is the plain read value lib/guard.ts takes. Without it each of these reads got a 403
// and quietly came back empty.
const READ_HEADERS = { headers: { "x-weft-token": "1" } };

module.exports = { READ_HEADERS };
