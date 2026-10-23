"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { copilotLaneOpen, copilotLanePeek, showBacklog, subscribeBoardPrefs } from "@/lib/board-prefs";
import { laneStateFromPrefs, type LaneState } from "@/lib/copilot-lane";
import { api, type BrowserState } from "@/lib/client";
import { worktreeParent } from "@/lib/format";
import { busyHere } from "@/lib/overlap";
import { planResets } from "@/lib/schedule";
import { COLUMNS, type Card, type Column, type Project } from "@/lib/types";
import { useShortcutHint } from "@/lib/hotkeys";
import { preloadChimes } from "@/lib/chimes";
import { useWorkspaceLayout } from "@/lib/use-workspace-layout";
import { onOpenFile } from "@/lib/open-file";
import {
  groupByColumn,
  hitPlanLimit,
  latestLimits,
  summarizeProjects,
} from "@/lib/board-view";
import { useBoardLive } from "@/lib/board-live";
import { useBoardDialogs } from "@/lib/use-board-dialogs";
import { useOpenCard } from "@/lib/use-open-card";
import { useNewThreadPane } from "@/lib/use-new-thread-pane";
import { filterState, footerFor, headerCounts, openCardOf, workFolder } from "@/lib/board-derive";
import { useRestart } from "@/lib/use-restart";
import { useDesktopBridge } from "@/lib/use-desktop-bridge";
import { useStartupCheck } from "@/lib/use-startup-check";
import { useNow } from "@/lib/use-now";
import { useToast } from "@/lib/use-toast";
import { useCopilotCard } from "@/lib/use-copilot-card";
import { useBoardCardActions } from "@/lib/use-board-card-actions";
import { useBoardView } from "@/lib/use-board-view";
import { useBoardArchive } from "@/lib/use-board-archive";
import { useBoardActions } from "@/lib/use-board-actions";
import { useBoardToggles } from "@/lib/use-board-toggles";
import { resumeActions } from "@/lib/resume-actions";
import { useEscape } from "@/lib/use-escape";
import { guarded } from "./guarded";
import { useBoardCommands } from "./use-board-commands";
import { filterCards, railPinned, toggleTag, type RailFilter, type RailPanel } from "@/lib/rail-view";
import { TagColors } from "./TagPill";
import { useTagCatalog } from "./use-tag-catalog";
import { useBoardMenus } from "./use-board-menus";
import { useSwitchAll } from "./switch-all-button";
import { folderName } from "./ProjectBar";
import { showPage } from "@/lib/board-helpers";
import { cardHandlers } from "@/lib/card-handlers";
import { useThreadHandlers } from "@/lib/thread-handlers";
import BoardHeader from "./BoardHeader";
import { CardSkeleton } from "./BoardColumn";
import BoardColumns from "./BoardColumns";
import OpenCard, { CardFrame } from "./OpenCard";
import BoardBottom from "./BoardBottom";
import BoardBrowserPane from "./BoardBrowserPane";
import BoardProjectBar from "./BoardProjectBar";

// Each loads in its own CrashGuard (components/guarded.tsx), so a piece a thread left half-written, even one that
// fails as its module loads, breaks only its own spot on the board.
const AccountButton = guarded(() => import("./AccountButton"), { inline: true, what: "account button" });
const CopilotButton = guarded(() => import("./CopilotButton"), { inline: true, what: "copilot button" });
const CopilotLane = guarded(() => import("./CopilotLane"), { what: "copilot", className: "self-stretch shrink-0" });
const OnboardingTips = guarded(() => import("./OnboardingTips"), { what: "onboarding tips", inline: true });
const RestartChip = guarded(() => import("./RestartChip"), { inline: true, what: "restart chip" });
const CardView = guarded(() => import("./CardView"), { what: "card", placeholder: <CardSkeleton /> });
const SideRail = guarded(() => import("./LibraryRail"), { what: "rail", className: "m-3 w-[220px] self-start" });
const HeaderBadges = guarded(() => import("./HeaderBadges"), { inline: true, what: "header badges" });
const NewCardDialog = guarded(() => import("./NewCardDialog"), { what: "New thread dialog", className: "m-3 w-[360px] self-start" });
// Every dialog, sheet and overlay over the board's columns — Settings, Tags…, Share…, the palette,
// file drop, the toast — each loading through its own guarded() import (components/BoardDialogs.tsx).
const BoardDialogs = guarded(() => import("./BoardDialogs"), { what: "dialogs", inline: true });

const CLOSED_BROWSER: BrowserState = {
  visible: false,
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
};

export default function Board() {
  const [cards, setCards] = useState<Card[]>([]);
  const [home, setHome] = useState("");
  const [loaded, setLoaded] = useState(false);
  const { toast, setToast, notify } = useToast();
  // Restart when idle (lib/restart-when-idle.ts): the header chip and the palette command.
  const restartView = useRestart();
  // The folder "New Thread in This Folder" asked for; otherwise the dialog picks.
  const [newCwd, setNewCwd] = useState<string | undefined>();
  // The left rail's open drawer (🏷 tags, 🔐 and the tools under it).
  const [libraryOpen, setLibraryOpen] = useState<RailPanel | null>(null);
  // ★ and 🏷 on the rail narrow the board to starred cards, a tag, or both.
  const [railFilter, setRailFilter] = useState<RailFilter>({});
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [webBrowserOpen, setWebBrowserOpen] = useState(false);
  // Which card is open, its thread and streaming text, the last one opened, Rename…, unseen moves (lib/use-open-card.ts).
  const {
    selectedId, setSelectedId, lastOpenId, thread, setThread, streaming, setStreaming,
    renameId, setRenameId, unseen, setUnseen, selectedRef, loadThread, select,
  } = useOpenCard({ setWebBrowserOpen });
  const [browserWidth, setBrowserWidth] = useState(560);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const { copilot, update: updateCopilot, load: loadCopilot } = useCopilotCard();
  const copilotNeedsYou = copilot?.column === "needs_you";
  const [projects, setProjects] = useState<Project[]>([]);
  // Worktree folder -> its main repo, from the server; the bar shows each worktree's cards under that repo.
  const [roots, setRoots] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // New thread, Settings, Share board, Help, the palette, a sign-in and the project menu (lib/use-board-dialogs.ts).
  const {
    showNew, setShowNew, setMenuOpen, showSettings, setShowSettings, sharingBoard, setSharingBoard,
    showHelp, setShowHelp, showPalette, setShowPalette, paletteQuery, setPaletteQuery, login, setLogin, overlay, boardKeys,
  } = useBoardDialogs();
  // The four-column workspace for an open card: open/close state, widths, and the divider drag.
  // Declared before the shortcuts below read workspace.toggle (lib/workspace-layout.ts has the rest).
  const workspace = useWorkspaceLayout();
  // Columns showing all their cards, for the project and filter they were expanded under.
  const [expanded, setExpanded] = useState<{ view: string; columns: Column[] }>({ view: "", columns: [] });
  // Each card's last known column, to notice when one moves.
  const columns = useRef(new Map<string, Column>());
  // Each card's last known error, to chime when a new one appears.
  const errors = useRef(new Map<string, string | undefined>());
  // Folders the server has already resolved into roots.
  const resolvedFolders = useRef(new Set<string>());
  const now = useNow();
  const { desktop, mac, browser } = useDesktopBridge(CLOSED_BROWSER, selectedId, cards);
  useStartupCheck(loaded, setToast);
  // The New thread dialog's splash page in the pane (lib/use-new-thread-pane.ts).
  useNewThreadPane(showNew, selectedRef);

  // Decode the chime files now, so the first card that moves isn't late to sound.
  useEffect(() => preloadChimes(), []);

  const rootOf = useCallback((cwd: string) => roots[cwd] ?? worktreeParent(cwd) ?? cwd, [roots]);

  // A card or project in a folder the server hasn't seen yet fetches the roots again, in case it's a worktree.
  const resolveFolders = useCallback((folders: string[]) => {
    const fresh = folders.filter((f) => !resolvedFolders.current.has(f) && !worktreeParent(f));
    if (!fresh.length) return;
    for (const f of fresh) resolvedFolders.current.add(f);
    api
      .list()
      .then((data) => setRoots(data.roots))
      .catch(() => {});
  }, []);

  // Computed early so the hooks below (actions, toggles, archive) can take it as a dep.
  const laneOpen = useSyncExternalStore(subscribeBoardPrefs, copilotLaneOpen, () => false);
  const lanePeek = useSyncExternalStore(subscribeBoardPrefs, copilotLanePeek, () => false);
  const laneState: LaneState = laneStateFromPrefs(laneOpen, lanePeek);
  // The copilot opens in the same window as any card, though it lives apart from `cards`.
  const selected = openCardOf(cards, copilot, selectedId);
  // The most recent card's folder, for places that need a cwd when no card is open.
  const latest = latestLimits(cards);
  const latestCwd = latest?.cwd;

  // Drag/drop, tag, and the "skip my own move's chime" ref (used by useBoardEvents below).
  const { ownMoves, move, drop, reorder, tagCard } = useBoardCardActions({ cards, setCards, setDragOver, notify });
  // Project filter and sort, persisted to a cookie.
  const { project, sort, chooseProject, chooseSort, loadFromPrefs, reviewFilter, toggleReviewFilter } = useBoardView({ select, setWebBrowserOpen });
  // Archive, unarchive, focus the next card, and the last batch (for Z / Undo).
  const { archiveTarget, archiveCards, toggleArchive, unarchive, lastArchived } = useBoardArchive({
    cards,
    selected,
    selectedIdRef: selectedRef,
    select,
    setToast,
    notify,
  });
  // Open, create, and the header badges' "start a card" callbacks.
  const { openCard, openNew, create, improveQuality, reviewAll } = useBoardActions({
    selected,
    select,
    setShowNew,
    setNewCwd,
    project,
    latestCwd,
    notify,
  });
  // Browser, terminal, and copilot-lane state.
  const { toggleBrowser, toggleTerminal, toggleCopilot, setCopilotState } = useBoardToggles({
    selectedRef,
    browserVisible: browser.visible,
    setWebBrowserOpen,
    setTerminalOpen,
    laneState,
    select,
  });

  // Live updates (lib/board-live.ts). The first open (and every reconnect) reloads everything, so nothing is missed.
  useBoardLive({
    columns, errors, ownMoves, selectedRef, resolvedFolders,
    select, setSelectedId, setCards, setUnseen, setThread, setStreaming, setProjects, setLogin, setToast, setHome, setRoots, setLoaded,
    updateCopilot, loadCopilot, resolveFolders, restart: restartView, loadFromPrefs, loadThread, notify,
  });

  // Picking another project or changing the filter collapses the columns again (lib/board-derive.ts).
  const { filtering, view } = filterState(project, query, railFilter);
  const expandedColumns = expanded.view === view ? expanded.columns : [];

  const byColumn = useMemo(
    () => groupByColumn(filterCards(cards, railFilter), { project, query, sort, showArchived, reviewFilter }, rootOf),
    [cards, railFilter, project, query, sort, showArchived, reviewFilter, rootOf],
  );
  const archivedCount = cards.filter((c) => c.archived && (!project || rootOf(c.cwd) === project)).length;
  // The Done cards on screen that Shift+E and "Archive all" file away.
  const doneToArchive = (byColumn.get("done") ?? []).filter((c) => !c.archived && c.column === "done");
  const { resume, all: resumeAll } = resumeActions(byColumn.get("review") ?? [], notify);
  // Backlog hides unless Settings turns it on, but never hides cards waiting in it.
  const backlogOn = useSyncExternalStore(subscribeBoardPrefs, showBacklog, () => false);
  const visibleColumns = COLUMNS.filter(
    (c) => c.id !== "backlog" || backlogOn || cards.some((card) => card.column === "backlog" && !card.archived),
  );

  const projectSummaries = useMemo(() => summarizeProjects(projects, cards, rootOf), [projects, cards, rootOf]);

  // The 🔐 drawer's vaults: every project's on the board, so you can add secrets to any of them and copy
  // between them; its filter starts on the selected project.
  const railFolders = useMemo(() => {
    const paths = projects.map((p) => p.path);
    return project && !paths.includes(project) ? [project, ...paths] : paths;
  }, [project, projects]);

  // An open card, or the New thread form, fills a framed window with the browser pane beside it.
  const framed = Boolean(selected) || showNew;
  const footer = footerFor(selected, latest);
  // Each folder has its own shell; with All projects showing, the latest card's folder.
  const folder = workFolder(selected, project, latest);
  const terminalCwd = folder ?? home;
  const browserOpen = desktop ? browser.visible : webBrowserOpen;
  const counts = headerCounts(cards);
  // "Switch all" only shows once a thread hit its plan limit.
  const limitHit = hitPlanLimit(cards);

  // Shortcuts that act on the board stand down while a dialog or the project menu is up.

  // Shortcuts, the command palette and the app menu (components/use-board-commands.ts).
  const { openPalette, paletteItems, findPrompts } = useBoardCommands({
    cards, selected, selectedId, projectSummaries, project, sort, home, columns: visibleColumns, query, boardKeys,
    dialogs: { showNew, showSettings, showHelp, showPalette, login },
    doneToArchive, lastArchived, archivedCount, showArchived, rootOf, restart: restartView.restart,
    openNew: () => openNew(), openCard, select, toggleCopilot, toggleBrowser, toggleTerminal, toggleColumn: workspace.toggle,
    setShowPalette, setPaletteQuery, setShowHelp, setShowSettings, setSharingBoard, setLibraryOpen, setShowArchived,
    archiveTarget, archiveCards, unarchive, toggleArchive, chooseSort, chooseProject, move, notify, toast: setToast,
  });
  const hint = useShortcutHint();

  // Escape closes the newest open layer. The board's own panels sit under any dialog or menu, even one
  // opened before them. The thread closes even mid-reply: ReplyBox keeps the draft for next time. A card
  // and its browser are one window, so they close together.
  useEscape(Boolean(selectedId), () => select(null), { panel: true });
  useEscape(browserOpen && !selectedId && !showNew, toggleBrowser, { panel: true });
  // Registered last, so an open rail drawer closes before the browser does.
  useEscape(Boolean(libraryOpen) && !selectedId && !showNew && !railPinned(), () => setLibraryOpen(null), { panel: true });

  const tagCatalog = useTagCatalog(cards, notify);
  // Open the editor column automatically when something asks for a file in this card's folder.
  // The editor itself drains the waiting requests in onOpenFile (lib/open-file.ts); here we just
  // flip the column open so the user sees the tab. `setOpenEditor` is captured to keep the
  // effect from depending on the whole `workspace` object (which re-creates each render).
  const setOpenEditor = workspace.setOpen;
  useEffect(() => {
    if (!selectedId) return;
    return onOpenFile(selectedId, () => setOpenEditor("editor", true));
  }, [selectedId, setOpenEditor]);
  const { onCardMenu, onColumnMenu, toggleStar, tagging, editTags, saveTags, closeTags, sharing, closeShare, shareCard } = useBoardMenus({
    doneShown: byColumn.get("done") ?? [],
    archivedCount,
    showArchived,
    openCard,
    renameCard: (card) => {
      openCard(card);
      setRenameId(card.id);
    },
    move,
    toggleArchive,
    archive: archiveCards,
    remove: (card) => {
      if (selectedRef.current === card.id) select(null);
      api.remove(card.id).catch(notify);
    },
    openNew,
    toggleArchived: () => setShowArchived((v) => !v),
    toast: setToast,
    notify,
  });
  const onTag = (tag: string) => setRailFilter((f) => toggleTag(f, tag));
  const cardCtx = { openCard, resume, onCardMenu, toggleStar, toggleArchive, onTag, notify };
  const threadProps = useThreadHandlers(selected, { select, notify });

  // "Switch all to <other CLI>" on the Running and Needs you columns. Idle cards flip right
  // away; busy ones come back in `pending` and the modal polls for them.
  const { switchColumn: switchAll, dialog: switchAllDialog } = useSwitchAll({
    byColumn,
    setToast: (msg) => setToast(msg),
    notify,
  });

  return (
    <TagColors.Provider value={tagCatalog.colors}>
    <div className="flex h-screen flex-col">
      <BoardHeader
        mac={mac}
        counts={counts}
        hint={hint}
        panes={{ browserOpen, terminalOpen, onToggleBrowser: toggleBrowser, onToggleTerminal: toggleTerminal }}
        onShareBoard={() => setSharingBoard(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenNew={() => openNew()}
        slots={{
          restart: <RestartChip restart={restartView.restart} notify={notify} />,
          badges: <HeaderBadges cwd={folder} cards={cards} start={improveQuality} notify={notify} toast={setToast} />,
          copilot: <CopilotButton open={laneOpen} needsYou={copilotNeedsYou} title={hint("copilot", "Copilot")} onClick={toggleCopilot} />,
          account: <AccountButton onOpenSettings={() => setShowSettings(true)} onShareBoard={() => setSharingBoard(true)} />,
        }}
      />

      <BoardProjectBar
        projects={projectSummaries}
        total={cards.length}
        project={project}
        onProject={chooseProject}
        railFilter={railFilter}
        onRailFilter={setRailFilter}
        query={query}
        onQuery={setQuery}
        byColumn={byColumn}
        onOpenCard={openCard}
        onSearchAll={openPalette}
        sort={sort}
        onSort={chooseSort}
        home={home}
        onMenuOpenChange={setMenuOpen}
      />

      <div className="flex min-h-0 flex-1">
        <SideRail
          open={libraryOpen}
          onOpen={setLibraryOpen}
          ctx={{ project, folders: railFolders, cards, onOpenUrl: showPage, onOpenCard: openCard, onStartCard: improveQuality, notify }}
          filter={railFilter}
          onFilter={setRailFilter}
          onStarCard={(id) => {
            const card = cards.find((c) => c.id === id);
            if (card && !card.starred) toggleStar(card);
          }}
          onTagCard={tagCard}
          catalog={tagCatalog}
          onClosePane={toggleBrowser}
          paneUrl={desktop ? browser.url : undefined}
        />
        {!framed && (
          // Only while no card is open (framed), so its X toggles the pane rather than closing a card.
          <BoardBrowserPane
            open={browserOpen}
            desktop={desktop}
            state={browser}
            width={browserWidth}
            onWidth={setBrowserWidth}
            obscured={overlay}
            onClose={toggleBrowser}
            items={thread}
          />
        )}
        <BoardColumns
          columns={visibleColumns}
          byColumn={byColumn}
          allCards={cards}
          expanded={expandedColumns}
          onExpand={(id) => setExpanded({ view, columns: [...expandedColumns, id] })}
          renderCard={(card) => (
            <CardView
              guardName={card.title}
              card={card}
              now={now}
              selected={card.id === selectedId}
              lastOpen={card.id === lastOpenId}
              unseen={unseen.has(card.id)}
              alsoHere={busyHere(cards, card)}
              {...cardHandlers(card, cardCtx)}
            />
          )}
          loaded={loaded}
          filtering={filtering}
          laneState={laneState}
          drag={{ over: dragOver, onOver: setDragOver, onLeave: (id) => setDragOver((c) => (c === id ? null : c)), onDrop: drop, onReorder: reorder }}
          onColumnMenu={(id, e) => void onColumnMenu(id, e)}
          archive={{
            count: archivedCount,
            shown: showArchived,
            onToggleShown: () => setShowArchived((v) => !v),
            done: doneToArchive,
            tip: hint("archive-done", `Archive all ${doneToArchive.length}`),
            cards: archiveCards,
            restore: unarchive,
          }}
          review={{ resumeAll, onReviewAll: reviewAll, filter: reviewFilter, toggleFilter: toggleReviewFilter }}
          onSwitchAll={limitHit ? switchAll : undefined}
          onNew={() => openNew()}
          toast={setToast}
          notify={notify}
        />
        <OnboardingTips cards={cards} loaded={loaded} filtering={filtering} />
        <CopilotLane
          state={laneState}
          cards={cards}
          project={project}
          onOpenCard={openCard}
          onHide={() => setCopilotState("hidden")}
          onPeek={() => setCopilotState("peek")}
          onOpen={() => setCopilotState("open")}
          toggleTip={hint("copilot", "Copilot")}
        />

        <CardFrame framed={framed} bottom={terminalOpen ? terminalHeight + 16 : undefined} onBackdrop={() => (showNew ? setShowNew(false) : select(null))}>
          {showNew ? (
            <NewCardDialog cards={cards} home={home} defaultCwd={newCwd ?? project ?? undefined} recentCwd={[...cards].sort((a, b) => b.updatedAt - a.updatedAt).find((c) => c.cwd !== home)?.cwd} restart={restartView.restart} onClose={() => setShowNew(false)} onCreate={create} />
          ) : selected && threadProps ? (
            <OpenCard
              card={selected}
              handlers={threadProps}
              items={thread}
              streaming={streaming}
              resets={planResets(cards)}
              editTitle={renameId === selected.id}
              workspace={workspace}
              browser={{ desktop, state: browser, width: browserWidth, onWidth: setBrowserWidth, obscured: overlay }}
              onStar={() => toggleStar(selected)}
              onTags={() => editTags(selected)}
              onShare={() => shareCard(selected)}
              onArchive={() => toggleArchive(selected)}
              onOpenSettings={() => setShowSettings(true)}
            />
          ) : null}
        </CardFrame>
      </div>

      <BoardBottom
        footer={footer}
        onHelp={() => setShowHelp(true)}
        terminal={{ open: terminalOpen, cwd: terminalCwd, height: terminalHeight, onHeight: setTerminalHeight, onClose: toggleTerminal }}
      />

      <BoardDialogs
        settings={showSettings}
        onCloseSettings={() => setShowSettings(false)}
        help={showHelp}
        onCloseHelp={() => setShowHelp(false)}
        tagging={tagging}
        tagOptions={tagCatalog.tags.map((t) => ({ tag: t.name, count: t.count }))}
        onTagsChange={saveTags}
        onCloseTags={closeTags}
        sharing={sharing}
        onCloseShare={closeShare}
        sharingBoard={sharingBoard}
        onCloseShareBoard={() => setSharingBoard(false)}
        palette={showPalette}
        paletteQuery={paletteQuery}
        paletteItems={paletteItems}
        findPrompts={findPrompts}
        paletteProject={project ? { path: project, name: folderName(project) } : null}
        onClosePalette={() => setShowPalette(false)}
        login={login}
        onCloseLogin={() => setLogin(null)}
        switchAllDialog={switchAllDialog}
        cards={cards}
        newOpen={showNew}
        onDropCard={openCard}
        onDropNew={() => openNew()}
        toast={toast}
        onDismissToast={() => setToast(null)}
      />
    </div>
    </TagColors.Provider>
  );
}

