// When the dev server exits without Weft asking (no stop(), no restart()), the supervisor (electron/server.cjs) notes
// the time in ~/.weft/server-exit.json. The next server reads it once on start (lib/crash-blame.ts consumeServerExit)
// and marks the card whose tool call stopped it, so the board shows which thread restarted Weft. Never throws: a
// note that can't be written only loses the blame.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function exitFile(env = process.env) {
  return path.join(env.WEFT_DATA || path.join(os.homedir(), ".weft"), "server-exit.json");
}

// asked: Weft stopped or restarted this process itself, or is quitting.
function noteExit({ code, signal, asked, file = exitFile(), now = Date.now() }) {
  if (asked) return false;
  try {
    fs.writeFileSync(file, JSON.stringify({ at: now, code, signal }));
    return true;
  } catch {
    return false;
  }
}

module.exports = { exitFile, noteExit };
