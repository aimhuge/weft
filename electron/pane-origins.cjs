// Where a thread may take a card's browser pane (L-5). It opens with no prompt: a file: or about: page (no remote
// origin), the host the pane is already on, a host you opened yourself in that card (one Set per pane key), and
// anything on the site list (electron/pane-sites.cjs: this Mac's own servers, the public top sites, hosts you
// said yes to before). Anything else asks you first, a card's first page included: an empty pane used to let a
// thread open any site unasked. The board's own calls and the restore after a restart don't come through here.

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

function hostOfOrigin(origin) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** @param {{ allows: (host: string) => boolean }} [sites] */
function canThreadOpen(authorized, targetKey, origin, priorOrigin, sites) {
  if (origin === null || origin === "null" || origin === priorOrigin) return true;
  if (sites?.allows(hostOfOrigin(origin))) return true;
  return Boolean(authorized.get(targetKey)?.has(origin));
}

function rememberBoardOrigin(authorized, targetKey, origin) {
  if (origin === null || origin === "null") return;
  const set = authorized.get(targetKey) ?? new Set();
  set.add(origin);
  authorized.set(targetKey, set);
}

// A thread asking for a host that isn't allowed yet: instead of refusing, ask the user (Touch ID, or a
// confirm dialog on a Mac without it). A yes saves the host to the site list, so no card asks for it again,
// even after a restart. Calls for the same pane and host while the question is up share it, so one prompt answers them all.
/** @param {{ authorized: Map<string, Set<string>>, pending: Map<string, Promise<boolean>>, targetKey: string, origin: string, priorOrigin: string | null, ask: (reason: string) => Promise<boolean>, sites?: { allows: (host: string) => boolean, add: (host: string) => unknown } }} call */
async function authorizeThreadOpen({ authorized, pending, targetKey, origin, priorOrigin, ask, sites }) {
  if (canThreadOpen(authorized, targetKey, origin, priorOrigin, sites)) return true;
  const id = `${targetKey}\n${origin}`;
  if (!pending.has(id)) {
    const host = new URL(origin).host;
    const asking = Promise.resolve()
      .then(() => ask(`open ${host} in a card's browser pane, now and from now on`))
      .catch(() => false)
      .then((ok) => {
        if (ok) rememberBoardOrigin(authorized, targetKey, origin);
        if (ok) sites?.add(host);
        return Boolean(ok);
      })
      .finally(() => pending.delete(id));
    pending.set(id, asking);
  }
  return pending.get(id);
}

module.exports = { originOf, canThreadOpen, rememberBoardOrigin, authorizeThreadOpen };
