"use client";

import { createContext } from "react";

// True when the open card's reply box and pending ask sit somewhere else: simple mode's full-page pane draws them in
// one full-width strip under the whole card (components/PaneBottom.tsx), so the thread beside the page leaves its own
// out and one card never has two reply boxes (docs/architecture/simple-mode.md, piece 1).
export const ReplyElsewhereContext = createContext(false);

// The look the open card's reply box takes: simple mode's full-page pane gives the thread column's own box the phone's
// look (Composer's look="phone"), so it matches the strip under the page it replaces while the thread is open.
export const ReplyLookContext = createContext<"phone" | undefined>(undefined);
