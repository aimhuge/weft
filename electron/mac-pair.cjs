// Pairing two of your Macs for "Pull Uncommitted Work" (docs/architecture/wip-sync.md#mac-to-mac). The Mac that will
// ask copies its code (its device id, its name and its desktop approval public key, electron/desktop-signer.cjs) and you
// paste it into Settings → Devices on the Mac that will answer, which pins that key after Touch ID (electron/mac-pins.cjs).
// The code carries no secret: what makes it trusted is that you carried it by hand, so nothing on the network can pin a
// key of its own. Board window only (the `handle` electron/pairing-ipc.cjs passes in), never a thread.
const os = require("node:os");

const PREFIX = "weft-mac1:";
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;
// Bidi overrides, control and format characters: the name is shown in Touch ID and must not bend it.
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/** @param {{ device: string, name: string, signKey: string }} mac */
const macCode = (mac) => PREFIX + Buffer.from(JSON.stringify(mac)).toString("base64url");

/** A code read back, or a string saying why not. @returns {{ device: string, name: string, signKey: string } | string} */
function parseMacCode(raw) {
  const text = String(raw ?? "").trim();
  if (!text.startsWith(PREFIX)) return "That isn't a Mac's pairing code. Copy it from Settings → Devices on the other Mac.";
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(text.slice(PREFIX.length), "base64url").toString("utf8"));
  } catch {
    return "That code is cut short. Copy it again.";
  }
  const { device, name, signKey } = parsed ?? {};
  if (typeof device !== "string" || !ID.test(device)) return "That code names no Mac.";
  if (typeof name !== "string" || !name.trim() || name.length > 60 || HIDDEN.test(name)) return "That code's Mac name can't be shown.";
  if (typeof signKey !== "string" || Buffer.from(signKey, "base64").length !== 32) return "That code carries no approval key.";
  return { device, name: name.trim(), signKey };
}

const macName = () => os.hostname().replace(/\.local$/, "").slice(0, 60) || "Mac";

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {{ pins: ReturnType<typeof import("./mac-pins.cjs").createMacPins>, macDevice: () => string, signKey: () => Promise<string>,
 *   confirm: (reason: string) => Promise<boolean>, name?: () => string, now?: () => number }} deps
 */
function registerMacPair(handle, { pins, macDevice, signKey, confirm, name = macName, now = Date.now }) {
  handle("mac-pair:code", async () => macCode({ device: macDevice(), name: name(), signKey: await signKey() }));
  // Trusting a key is the step that widens, so it takes Touch ID, in main's words over the name and id it pins.
  handle("mac-pair:trust", async (raw) => {
    const mac = parseMacCode(raw);
    if (typeof mac === "string") throw new Error(mac);
    if (mac.device === macDevice()) throw new Error("That's this Mac's own code. Paste it on your other Mac.");
    if (!(await confirm(`let the Mac ${mac.name} (${mac.device.slice(0, 16)}) ask this Mac for its uncommitted work`))) return null;
    pins.pin({ id: mac.device, name: mac.name, signKey: mac.signKey, pairedAt: new Date(now()).toISOString() });
    return { id: mac.device, name: mac.name };
  });
  handle("mac-pair:list", () => pins.list().map((m) => ({ id: m.id, name: m.name, pairedAt: m.pairedAt })));
  // Forgetting only narrows trust, so it needs no Touch ID.
  handle("mac-pair:forget", (id) => pins.unpin(String(id)));
}

module.exports = { registerMacPair, macCode, parseMacCode, PREFIX };
