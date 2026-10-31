// This Mac's heartbeat in public.devices (docs/architecture/team-asks.md): while Weft runs and someone is signed in,
// last_seen_at moves, so the team's Devices page and the project roster can tell a live Mac from a forgotten one.
//
// It reads the public half straight from device-key.json rather than through loadDeviceKey, because that would unseal
// the private half, and with it touch the Keychain, every few minutes for no reason. A Mac with no key file or no row
// beats nothing: registering stays a step of its own.
const fs = require("node:fs");
const path = require("node:path");
const { DEVICE_KEY_FILE } = require("./device-key.cjs");

const BEAT_MS = 5 * 60 * 1000;
const FIRST_BEAT_MS = 30 * 1000; // Time for the saved sign-in to load, and nothing added to startup.

function publicKeyIn(dir) {
  try {
    const { publicKey } = JSON.parse(fs.readFileSync(path.join(dir, DEVICE_KEY_FILE), "utf8"));
    return typeof publicKey === "string" ? publicKey : null;
  } catch {
    return null;
  }
}

/**
 * One beat. Never throws: a dropped network only means this Mac reads as a little older.
 * @param {{ accountClient: any, dir: string, now?: () => number }} deps
 * @returns {Promise<boolean>} whether a beat was sent
 */
async function beatDevice({ accountClient, dir, now = Date.now }) {
  try {
    const userId = accountClient?.getClaims?.()?.sub;
    const publicKey = publicKeyIn(dir);
    if (typeof userId !== "string" || !publicKey) return false;
    const { error } = await accountClient.supabase
      .from("devices")
      .update({ last_seen_at: new Date(now()).toISOString() })
      .eq("user_id", userId)
      .eq("public_key", publicKey)
      .is("revoked_at", null);
    if (error) console.warn(`Device beat: ${error.message}`);
    return !error;
  } catch (err) {
    console.warn(`Device beat: ${/** @type {Error} */ (err).message}`);
    return false;
  }
}

/**
 * Beat from now on. The timers are unref'd so they never hold the app open.
 * @param {{ accountClient: () => any, dir: string }} deps
 * @returns {() => void} stops the beat
 */
function startDeviceBeat({ accountClient, dir }) {
  const beat = () => void beatDevice({ accountClient: accountClient(), dir });
  const first = setTimeout(beat, FIRST_BEAT_MS);
  const every = setInterval(beat, BEAT_MS);
  first.unref?.();
  every.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

module.exports = { beatDevice, startDeviceBeat, BEAT_MS, FIRST_BEAT_MS };
