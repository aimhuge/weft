// The state and effects behind the editor column: tabs (persisted in localStorage), the open-file
// queue (drained on mount and on each new event), the ⌘P / ⌘W hotkeys, the lazy HEAD fetch for a
// code tab in Changes mode, and the markdown round-trip baseline. The component is just the JSX.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeTab,
  isMarkdownPath,
  loadTabs,
  normalizePath,
  openTab,
  saveTabs,
  setActive,
  setLine,
  setMode,
  type EditorTab,
  type EditorTabsState,
} from "@/lib/editor-tabs";
import { drainOpenFiles, onOpenFile, type OpenFileRequest } from "@/lib/open-file";
import { useFilesSource } from "@/lib/files-source";

// State of the HEAD text for a code tab in Changes mode. A string once fetched (empty string when
// untracked), or null when the fetch failed. "loading" is exposed as the `headLoading` boolean
// derived from whether a path is absent from this map.
export type HeadText = string | null;

export interface UseEditorColumnResult {
  tabs: EditorTab[];
  activeTab: EditorTab | null;
  activePath: string | null;
  setActive: (path: string) => void;
  close: (path: string) => void;
  setMode: (path: string, mode: "edit" | "changes" | "source") => void;
  openQuick: boolean;
  showQuickOpen: () => void;
  hideQuickOpen: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  applyRequest: (req: OpenFileRequest) => void;
  head: HeadText | undefined;
  headLoading: boolean;
  headLoaded: boolean;
  // The markdown editor's round-trip baseline. Updated only when the user types (so the first
  // round-trip after mount is captured).
  mdBaselineRef: React.RefObject<string>;
  onMdChange: (md: string) => void;
}

// Apply one open-file request to the current tabs. Extracted so the column can call it from both
// the queue drain and the live event listener.
function applyRequestTo(state: EditorTabsState, req: OpenFileRequest, cwd: string): EditorTabsState {
  const path = normalizePath(req.path, cwd);
  if (!path) return state;
  const opened = openTab(state, path, cwd);
  let next = setActive(opened, path);
  if (req.diff && !isMarkdownPath(path)) next = setMode(next, path, "changes");
  if (req.line) next = setLine(next, path, req.line);
  return next;
}

// The first tabs state: the persisted set, folded with any requests that were waiting before the
// column mounted. Done in a useState lazy initializer so the drain happens before the first render
// (and the effect that mounts the column doesn't have to set state).
function initialTabs(cardId: string, cwd: string): EditorTabsState {
  const stored = loadTabs(cardId);
  const pending = drainOpenFiles(cardId);
  if (pending.length === 0) return stored;
  return pending.reduce((acc, req) => applyRequestTo(acc, req, cwd), stored);
}

export function useEditorColumn(cardId: string, cwd: string): UseEditorColumnResult {
  const filesApi = useFilesSource();
  // The tabs state, initialized from storage and any pre-mount open requests.
  const [tabs, setTabs] = useState<EditorTabsState>(() => initialTabs(cardId, cwd));
  const [openQuick, setOpenQuick] = useState(false);
  // Per-path HEAD text fetches. A path is absent until its first fetch resolves. We avoid setting
  // this state synchronously inside the effect by triggering the fetch via a state derived from
  // `tabs` only (no setState in the effect body).
  const [headTexts, setHeadTexts] = useState<Record<string, HeadText>>({});
  // A ref to the latest tabs for the ⌘W hotkey (which doesn't re-bind on every tab change).
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  });
  // The markdown editor's first round-tripped view of the file; set the first time the user types.
  const mdBaselineRef = useRef<string>("");

  // Persist tabs to localStorage on every change.
  useEffect(() => {
    saveTabs(cardId, tabs);
  }, [cardId, tabs]);

  // Listen for new open-file requests for this card. Pre-mount requests are drained in the
  // useState initializer above; this listener only fires for events that arrive after mount.
  useEffect(() => {
    return onOpenFile(cardId, (req) => {
      setTabs((s) => applyRequestTo(s, req, cwd));
    });
  }, [cardId, cwd]);

  // The active tab. Computed during render (it's a derivation of `tabs`).
  const activeTab: EditorTab | null = tabs.activePath
    ? tabs.tabs.find((t) => t.path === tabs.activePath) ?? null
    : null;

  // Head text for the diff mode: fetched lazily the first time a code tab is in changes mode.
  // The effect itself doesn't set state; it kicks off the fetch and updates state inside the
  // .then chain. We also don't fetch if we've already fetched once (the result is in headTexts).
  useEffect(() => {
    if (!activeTab || activeTab.mode !== "changes" || isMarkdownPath(activeTab.path)) return;
    const path = activeTab.path;
    if (headTexts[path] !== undefined) return;
    let cancelled = false;
    filesApi
      .head(cardId, path)
      .then((text) => {
        if (cancelled) return;
        setHeadTexts((s) => ({ ...s, [path]: text }));
      })
      .catch(() => {
        if (cancelled) return;
        setHeadTexts((s) => ({ ...s, [path]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, activeTab, headTexts, filesApi]);

  // ⌘P and ⌘W when focus is anywhere in the column. The handler reads the latest tabs from
  // tabsRef so it doesn't need to re-bind on every tab change.
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === "p") {
      e.preventDefault();
      setOpenQuick(true);
    } else if (key === "w" && tabsRef.current.activePath) {
      e.preventDefault();
      const path = tabsRef.current.activePath;
      setTabs((s) => closeTab(s, path));
    }
  }, []);

  const setActivePath = useCallback((path: string) => {
    setTabs((s) => setActive(s, path));
  }, []);

  const close = useCallback((path: string) => {
    setTabs((s) => closeTab(s, path));
  }, []);

  const setTabMode = useCallback((path: string, mode: "edit" | "changes" | "source") => {
    setTabs((s) => setMode(s, path, mode));
  }, []);

  const showQuickOpen = useCallback(() => setOpenQuick(true), []);
  const hideQuickOpen = useCallback(() => setOpenQuick(false), []);

  const applyRequest = useCallback(
    (req: OpenFileRequest) => {
      setTabs((s) => applyRequestTo(s, req, cwd));
    },
    [cwd],
  );

  const onMdChange = useCallback((md: string) => {
    if (!mdBaselineRef.current) mdBaselineRef.current = md;
  }, []);

  // Reset the markdown baseline when the active path changes.
  useEffect(() => {
    mdBaselineRef.current = "";
  }, [activeTab?.path]);

  const head = activeTab ? headTexts[activeTab.path] : undefined;
  const headLoading = !!activeTab && activeTab.mode === "changes" && !isMarkdownPath(activeTab.path) && head === undefined;
  const headLoaded = head !== undefined;

  return {
    tabs: tabs.tabs,
    activeTab,
    activePath: tabs.activePath,
    setActive: setActivePath,
    close,
    setMode: setTabMode,
    openQuick,
    showQuickOpen,
    hideQuickOpen,
    onKeyDown,
    applyRequest,
    head,
    headLoading,
    headLoaded,
    mdBaselineRef,
    onMdChange,
  };
}
