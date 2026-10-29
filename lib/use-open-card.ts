import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, mergeThread } from "./client";
import { without } from "./board-helpers";
import type { ThreadItem } from "./types";

// Which card is open, and the thread beside it: the state Board.tsx used to carry inline, now one
// hook, so the board's body reads as wiring and this can be tested on its own.

export interface OpenCardState {
  // The open card's id, or null when the board is the whole window.
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  // The card you opened last: still outlined after you close it, so you can find your place on the board.
  lastOpenId: string | null;
  setLastOpenId: Dispatch<SetStateAction<string | null>>;
  // The open card's thread items; the live stream writes onto these (lib/board-live.ts).
  thread: ThreadItem[];
  setThread: Dispatch<SetStateAction<ThreadItem[]>>;
  // The text streaming in right now, shown under the thread while a turn runs.
  streaming: string;
  setStreaming: Dispatch<SetStateAction<string>>;
  // The card opened from Rename…, so its title opens ready to edit.
  renameId: string | null;
  setRenameId: Dispatch<SetStateAction<string | null>>;
  // Cards that moved (with a chime) while you weren't looking; highlighted until you open them.
  unseen: ReadonlySet<string>;
  setUnseen: Dispatch<SetStateAction<ReadonlySet<string>>>;
  // The open card, readable from callbacks and effects without taking selectedId as a dep.
  selectedRef: { current: string | null };
  loadThread: (id: string, options?: { merge?: boolean }) => void;
  select: (id: string | null) => void;
}

export function useOpenCard({
  setWebBrowserOpen,
  openPane,
}: {
  setWebBrowserOpen: (open: boolean) => void;
  // Opens the browser pane's column, even one the user closed earlier: a thread never opens
  // beside an empty slot.
  openPane: () => void;
}): OpenCardState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The card you opened last: still outlined after you close it, so you can find your place on the board.
  const [lastOpenId, setLastOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [streaming, setStreaming] = useState("");
  // The card opened from Rename…, so its title opens ready to edit.
  const [renameId, setRenameId] = useState<string | null>(null);
  // Cards that moved (with a chime) while you weren't looking; highlighted until you open them.
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  const selectedRef = useRef<string | null>(null);
  // The board's openPane changes identity whenever the workspace layout does, so it is read through
  // a ref: select keeps one identity across renders, and the effects that depend on it don't re-run.
  const openPaneRef = useRef(openPane);

  useEffect(() => {
    openPaneRef.current = openPane;
  }, [openPane]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // merge keeps live items that arrived during the fetch; without it (after a reconnect, when what's
  // shown may be stale) the snapshot replaces the thread.
  const loadThread = useCallback((id: string, { merge = false }: { merge?: boolean } = {}) => {
    api
      .thread(id)
      .then((data) => {
        if (selectedRef.current === id) setThread((prev) => (merge ? mergeThread(data.items, prev) : data.items));
      })
      .catch(() => {});
  }, []);

  const select = useCallback(
    (id: string | null) => {
      // A card always opens full screen, with its browser beside the thread; closing it hides the browser.
      // Opening any card brings the pane back, even one the user closed earlier: the thread never
      // opens beside an empty slot.
      if (id) openPaneRef.current();
      // The card's id goes with the ask, so the shell makes this card's view and not the one that
      // happened to be active — the board's own, whose page would flash over the new card.
      if (window.weft) window.weft.browser.setVisible(Boolean(id), id);
      else setWebBrowserOpen(Boolean(id));
      selectedRef.current = id;
      setSelectedId(id);
      if (id) setLastOpenId(id);
      setRenameId(null);
      if (id) setUnseen((prev) => (prev.has(id) ? without(prev, id) : prev));
      setThread([]);
      setStreaming("");
      if (id) loadThread(id, { merge: true });
    },
    // setWebBrowserOpen is a useState setter on the board, so select keeps one identity across renders.
    [loadThread, setWebBrowserOpen],
  );

  return {
    selectedId,
    setSelectedId,
    lastOpenId,
    setLastOpenId,
    thread,
    setThread,
    streaming,
    setStreaming,
    renameId,
    setRenameId,
    unseen,
    setUnseen,
    selectedRef,
    loadThread,
    select,
  };
}