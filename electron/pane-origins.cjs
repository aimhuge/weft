// The set of origins a user explicitly opened on each browser pane (L-5): one Set per pane key.
// A thread's control-server call can navigate only within an origin the user already opened, or
// the same origin the pane is on. file: and about: URLs have no remote origin and are always
// allowed; the first load (priorOrigin null) is the board's restore call.

// The origin (scheme + host + port) of a URL. file: and about: URLs have no origin; we return the
// string "null" so the caller can treat them uniformly (the URL spec's "null origin" serialises
// to the literal string "null" in WebKit too — same-host same-scheme check just works).
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function canThreadOpen(authorized, targetKey, origin, priorOrigin) {
  if (origin === null || origin === "null" || !priorOrigin || origin === priorOrigin) return true;
  return Boolean(authorized.get(targetKey)?.has(origin));
}

function rememberBoardOrigin(authorized, targetKey, origin) {
  if (origin === null || origin === "null") return;
  const set = authorized.get(targetKey) ?? new Set();
  set.add(origin);
  authorized.set(targetKey, set);
}

// A thread asking for a host the user hasn't opened: instead of refusing, ask the user (Touch ID, or a
// confirm dialog on a Mac without it). A yes adds the host to that pane's set, as if the user had opened
// it. Calls for the same pane and host while the question is up share it, so one prompt answers them all.
async function authorizeThreadOpen({ authorized, pending, targetKey, origin, priorOrigin, ask }) {
  if (canThreadOpen(authorized, targetKey, origin, priorOrigin)) return true;
  const id = `${targetKey}\n${origin}`;
  if (!pending.has(id)) {
    const asking = Promise.resolve()
      .then(() => ask(`open ${new URL(origin).host} in a card's browser pane`))
      .catch(() => false)
      .then((ok) => {
        if (ok) rememberBoardOrigin(authorized, targetKey, origin);
        return Boolean(ok);
      })
      .finally(() => pending.delete(id));
    pending.set(id, asking);
  }
  return pending.get(id);
}

module.exports = { originOf, canThreadOpen, rememberBoardOrigin, authorizeThreadOpen };
