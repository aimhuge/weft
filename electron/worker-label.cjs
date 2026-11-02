// How a Touch ID prompt names a Weft Worker: by the name this Mac pinned for it (electron/worker-pins.cjs), which the
// worker can't change, not the name on its row, which anyone holding its key can rewrite (a worker could call itself
// "your bank"). A worker this Mac hasn't pinned yet shows the row's name marked as unverified.
const clean = (v) => String(v ?? "").replace(/[^\p{L}\p{N} ._:()/-]/gu, "").slice(0, 60);

/**
 * @param {{ nameOf(id: string): string | null }} pins
 * @param {unknown} id the worker's id @param {unknown} rowName the name on its row
 */
function workerLabel(pins, id, rowName) {
  const pinned = pins.nameOf(String(id ?? ""));
  if (pinned) return clean(pinned) || "your worker";
  return `${clean(rowName) || "a worker"} (name not verified)`;
}

module.exports = { workerLabel, clean };
