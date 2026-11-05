// Find in the page on screen in the browser pane. The field is the board's (components/PaneFind.tsx), since
// nothing in the board can sit over the native view; this drives Chromium's own find on the active tab and
// reports its count back. Only one page has a find going: the board moves it when the tab or card changes.
const MAX_QUERY = 1000;

function createPaneFind({ current, send }) {
  let searched = null;

  function clear(wc, refocus) {
    if (!wc || wc.isDestroyed()) return;
    wc.stopFindInPage("clearSelection");
    if (refocus) wc.focus();
  }

  // next: a step within the same search. Electron's own findNext option means the opposite: true starts a new one.
  function find(text, { forward = true, next = false } = {}) {
    const wc = current();
    if (!wc || wc.isDestroyed() || !text) return;
    if (searched !== wc) clear(searched);
    searched = wc;
    wc.findInPage(String(text).slice(0, MAX_QUERY), { forward, findNext: !next });
  }

  // refocus hands the keyboard back to the page, where the find started.
  function stop(refocus = false) {
    clear(searched ?? (refocus ? current() : null), refocus);
    searched = null;
  }

  function watch(wc) {
    wc.on("found-in-page", (_e, result) => {
      if (wc === searched) send({ active: result.activeMatchOrdinal ?? 0, matches: result.matches ?? 0 });
    });
  }

  return { find, stop, watch };
}

module.exports = { createPaneFind };
