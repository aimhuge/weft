// The tabs of each card's browser (electron/browser-pane.cjs): which pages a card holds and which one
// is current. Pure bookkeeping over whatever a tab carries (a WebContentsView in the pane, a plain
// object in tests), so it's tested without Electron.

function createPaneTabs() {
  // key → { tabs: [{ id, view }], current: id }
  const byKey = new Map();
  let nextId = 1;

  function entry(key) {
    return byKey.get(key);
  }

  // The tab on screen for a card, or undefined when the card has no tab yet.
  function current(key) {
    const e = entry(key);
    return e?.tabs.find((t) => t.id === e.current);
  }

  // Adds a tab to a card after its current one (like a browser's new tab) and makes it current.
  function add(key, view) {
    const tab = { id: nextId++, view };
    const e = entry(key);
    if (!e) {
      byKey.set(key, { tabs: [tab], current: tab.id });
      return tab;
    }
    const at = e.tabs.findIndex((t) => t.id === e.current);
    e.tabs.splice(at + 1, 0, tab);
    e.current = tab.id;
    return tab;
  }

  // True when the card has that tab (so it's now current).
  function select(key, id) {
    const e = entry(key);
    if (!e?.tabs.some((t) => t.id === id)) return false;
    e.current = id;
    return true;
  }

  // Closes a tab and hands it back to be destroyed. A card's last tab stays: the pane always has a page slot.
  // Closing the current one moves to its right-hand neighbour, else its left, like a browser.
  function close(key, id) {
    const e = entry(key);
    if (!e || e.tabs.length < 2) return undefined;
    const at = e.tabs.findIndex((t) => t.id === id);
    if (at < 0) return undefined;
    const [tab] = e.tabs.splice(at, 1);
    if (e.current === id) e.current = (e.tabs[at] ?? e.tabs[at - 1]).id;
    return tab;
  }

  // A card's tabs, oldest first.
  /** @returns {{ id: number, view: any }[]} */
  function list(key) {
    return entry(key)?.tabs ?? [];
  }

  // Every tab of every card, with its card's key.
  /** @returns {Generator<{ key: string, id: number, view: any }>} */
  function* all() {
    for (const [key, e] of byKey) for (const tab of e.tabs) yield { key, ...tab };
  }

  // Forgets a card and hands back its tabs to be destroyed.
  function remove(key) {
    const tabs = list(key);
    byKey.delete(key);
    return tabs;
  }

  return { current, add, select, close, list, all, remove, keys: () => [...byKey.keys()] };
}

module.exports = { createPaneTabs };
