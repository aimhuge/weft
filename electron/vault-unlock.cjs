// The vault's unlock timer (electron/vault.cjs): one Touch ID keeps reveal and copy open for UNLOCK_MS from the
// last use, and a thread's fill approval for one site the same (vault.useFor).

// How long one Touch ID keeps reveal and copy open, counted from the last use.
const UNLOCK_MS = 3 * 60_000;

// Keeps reveal and copy open for a while after one Touch ID. Without Touch ID (a Mac without it, or the
// lid shut on an external keyboard) prompt falls back to a confirmation dialog.
function createUnlock({ prompt, now = Date.now, idleMs = UNLOCK_MS }) {
  let until = 0;
  return {
    async ensure(reason) {
      if (now() < until) {
        until = now() + idleMs;
        return true;
      }
      if (!(await prompt(reason))) return false;
      until = now() + idleMs;
      return true;
    },
    unlocked: () => now() < until,
    lock() {
      until = 0;
    },
  };
}

module.exports = { createUnlock, UNLOCK_MS };
