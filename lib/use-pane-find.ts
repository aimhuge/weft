"use client";

import { useEffect, useState } from "react";

// Whether the browser pane's toolbar shows its find bar (components/PaneFindBar.tsx) in place of the address bar.
// ⌘F on the page opens it (electron/menus.cjs → "browser:find"); focus counts the ⌘Fs, so another one puts the
// cursor back in the field. Nothing to find with no page open.
export function usePaneFind(url: string | undefined) {
  const [focus, setFocus] = useState(0);
  useEffect(() => window.weft?.browser.onFind?.(() => setFocus((n) => n + 1)), []);
  return { open: focus > 0 && Boolean(url), focus, close: () => setFocus(0) };
}
