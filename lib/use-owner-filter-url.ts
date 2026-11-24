"use client";

// Keeps the board's person and machine filters (RailFilter's who and on, lib/board-owners.ts) in the page's URL as
// ?who=…&on=…, on both boards, so a filtered view can be bookmarked, shared or reloaded. On mount it takes what the URL
// says (weft.zip's page already handed it over, so nothing changes there); after that, the URL follows the filter.
import { useEffect, useRef } from "react";
import { readOwnerParams, withOwnerParams } from "./board-owners";
import type { RailFilter } from "./rail-view";

export function useOwnerFilterUrl(filter: RailFilter, setFilter: (update: (f: RailFilter) => RailFilter) => void) {
  const read = useRef(false);
  useEffect(() => {
    if (!read.current) {
      read.current = true;
      const { who, on } = readOwnerParams(window.location.search);
      // The URL's filter wins on the first look; the next render writes it back unchanged.
      if ((who || on) && (who !== filter.who || on !== filter.on)) {
        setFilter((f) => ({ ...f, who, on }));
        return;
      }
    }
    const next = withOwnerParams(window.location.href, filter);
    if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
  }, [filter, setFilter]);
}
