"use client";

// The weft.zip board at /[orgSlug]/board, drawn as the desktop window: the desktop's own BoardHeader, BoardProjectBar,
// BoardColumns and CardView, over the opted-in cards the Macs sync (docs/architecture/cloud-sync.md). The thread in an
// open card is the desktop's own ThreadPanel over the cloud transport (useCloudTransport.ts), so the reply box is the
// desktop's too — the transport leaves out what only the Mac can do, so those views don't offer it. Every card's host is
// the web's one host (useWebHost.ts), so the tiles, drag, the right-click menu (WebMenu.tsx), archive with Undo and the
// thread's header are the desktop's own, sending host verbs to the machine that runs the card (useWebCards.tsx).
//
// Server hands it the org id, the initial rows and, with ?card=…, that card's first page of thread; useWebBoard keeps
// them live over Supabase Realtime.
import { useCallback, useEffect, useMemo, useState } from "react";
import { groupByColumn, summarizeProjects, type SortKey } from "@/lib/board-view";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pageFromRows } from "@/lib/cloud-thread-page";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { useNow } from "@/lib/use-now";
import { useViewMode } from "@/lib/use-view-mode";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import { COLUMNS, type Column, type ThreadItem } from "@/lib/types";
import { boardCounts, webCards } from "@/lib/web-board";
import { filterCards, isFiltering, type RailFilter } from "@/lib/rail-view";
import { boardCommands, canReply, cardReplies, webTargets } from "@/lib/web-commands";
import { plainInputCommand } from "@/lib/screen-input";
import type { BoardInput } from "@/lib/worker-commands";
import type { Card } from "@/lib/types";
import BoardHeader from "../BoardHeader";
import BoardProjectBar from "../BoardProjectBar";
import BoardSurface from "../BoardSurface";
import { useShortcutHint } from "@/lib/hotkeys";
import { WebAccountMenu, type WebOrg, type WebUser } from "./WebAccountMenu";
import { WebLiveDot } from "./WebLiveDot";
import { WebShareBoard } from "./WebShareBoard";
import { useWebBoard } from "./useWebBoard";
import { WebCommandStrip } from "./WebCommandStrip";
import { WebNewCardDialog } from "./WebNewCardDialog";
import { WebRail } from "./WebRail";
import { WebReplyStatus } from "./WebReplyStatus";
import { CloudBlobContext } from "./useCloudTransport";
import { WebThreadPanel } from "./WebThreadPanel";
import { useSignWindow } from "./useSignWindow";
import { useHostForEveryCard, useOptimisticCards, useWebLine } from "./useWebHost";
import { useWebCards } from "./useWebCards";

export interface WebBoardProps {
  orgId: string;
  orgSlug: string;
  userId: string;
  // The signed-in visitor and their workspaces, for the account menu.
  user: WebUser;
  orgs: readonly WebOrg[];
  initialCommands: CloudCommandRow[];
  initialCards: CloudCardRow[];
  openCardId: string | null;
  initialThread: CloudThreadItemRow[];
  initialBlobUrls: Record<string, string>;
}

// A card's folder is its project; there is no worktree folding here, so a path stands for itself.
const identity = (cwd: string) => cwd;

export function WebBoard({ orgId, orgSlug, userId, user, orgs, initialCommands, initialCards, openCardId, initialThread, initialBlobUrls }: WebBoardProps) {
  const board = useWebBoard({ orgId, userId, initialCommands, initialCards, openCardId, initialBlobUrls });
  const signer = useSignWindow(board.client);
  // What the open thread draws, for its pane; the ?card= card starts from the thread the server read.
  const [seed] = useState(() => (openCardId ? pageFromRows(openCardId, initialThread).items : []));
  const [shown, setShown] = useState<ThreadItem[]>(seed);
  const blobs = useMemo(() => ({ ...board.blobs, onShown: setShown }), [board.blobs]);
  const now = useNow();
  const hint = useShortcutHint();
  const [project, setProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Column[]>([]);
  const [composing, setComposing] = useState(false);
  // The rail's ★ and 🏷, the desktop's own filter shape (lib/rail-view.ts).
  const [railFilter, setRailFilter] = useState<RailFilter>({});
  // The board's layout: cards in columns or in one list (lib/use-view-mode.ts).
  const { mode: viewMode, choose: chooseView } = useViewMode();

  useHostForEveryCard(board.host);
  const cards = useOptimisticCards(useMemo(() => webCards(board.cards), [board.cards]));
  const rows = useMemo(() => new Map(board.cards.map((r) => [r.card_id, r])), [board.cards]);
  const mine = useCallback((id: string) => {
    const row = rows.get(id);
    return Boolean(row && canReply(row, userId));
  }, [rows, userId]);
  const starredCount = cards.filter((c) => c.starred).length;
  // The board narrowed by ★ and a tag, the desktop's own filter.
  const visible = useMemo(() => filterCards(cards, railFilter), [cards, railFilter]);
  const byColumn = useMemo(
    () => groupByColumn(visible, { project, query, sort, showArchived }, identity),
    [visible, project, query, sort, showArchived],
  );
  const projects = useMemo(() => summarizeProjects([], cards, identity), [cards]);
  const { running, waiting } = boardCounts(cards);
  const targets = useMemo(() => webTargets(board.cards, userId), [board.cards, userId]);
  const archivedCount = cards.filter((c) => c.archived).length;
  const filtering = project !== null || query.trim() !== "" || isFiltering(railFilter);

  const active = board.activeCardId ? rows.get(board.activeCardId) : undefined;
  const activeCard = active && (cards.find((c) => c.id === active.card_id) ?? active.card);
  useNewThreadKey(!active && !composing, () => setComposing(true));
  // Your own worker card holds its worker's session line while it's open.
  const lineWorker = useWebLine(board.lines, active, userId);

  // A tile's Allow or Deny goes as the open thread's does: signed on sign.weft.zip while a passkey is paired.
  const answerTile = (card: Card, allow: boolean) => {
    const row = rows.get(card.id);
    if (!row) return;
    if (signer.needs(row, allow)) signer.open(row);
    else void board.answer(row, allow).then((failed) => failed && web.notify(failed));
  };
  const web = useWebCards({
    cards,
    mine,
    now,
    selectedId: board.activeCardId,
    open: (card) => board.openCard(card.id),
    close: board.closeCard,
    openNew: () => setComposing(true),
    answer: answerTile,
    showArchived,
    toggleArchived: () => setShowArchived((v) => !v),
    onTag: (tag) => setRailFilter((f) => ({ ...f, tag: f.tag === tag ? undefined : tag })),
  });
  // A tap or swipe on a worker card's live screen, as an `input` command for its worker.
  const screenInput = (input: BoardInput) => {
    const row = active && plainInputCommand({ orgId, device: active.owner_device, folder: active.folder, cardId: active.card_id }, input);
    return row ? board.send(row).then((failed) => { if (failed) throw new Error(failed); }) : Promise.reject(new Error("That isn't something the screen takes."));
  };

  return (
    <ToolResultSourceContext.Provider value={board.toolOutput}>
      <ThreadTransportContext.Provider value={board.transport}>
      <CloudBlobContext.Provider value={blobs}>
      <div className="wz-desk" data-theme="dark">
        <BoardHeader
          mac={false}
          variant="web"
          counts={{ running, waiting }}
          hint={hint}
          panes={{ browserOpen: false, terminalOpen: false, onToggleBrowser: noop, onToggleTerminal: noop }}
          onShareBoard={noop}
          onOpenSettings={noop}
          onOpenNew={() => setComposing(true)}
          slots={{
            restart: null,
            badges: null,
            copilot: null,
            account: <WebAccountMenu user={user} orgs={orgs} orgSlug={orgSlug} />,
            share: <WebShareBoard orgSlug={orgSlug} />,
            live: <WebLiveDot status={board.live} />,
          }}
        />

        <WebCommandStrip commands={boardCommands(board.commands)} onDrop={(id) => void board.dropCommand(id)} />

        {cards.length === 0 ? (
          <p className="m-6 rounded-lg border border-line bg-sunken p-6 text-[13.5px] leading-relaxed text-muted">
            No synced cards yet. Cards show here once you turn on Sync for a project in the Weft desktop app (<strong className="text-ink">Settings → Sync</strong>).
          </p>
        ) : (
          <>
            <BoardProjectBar
              variant="web"
              projects={projects}
              total={cards.length}
              project={project}
              onProject={setProject}
              railFilter={railFilter}
              onRailFilter={setRailFilter}
              query={query}
              onQuery={setQuery}
              byColumn={byColumn}
              onOpenCard={(card) => board.openCard(card.id)}
              onSearchAll={noop}
              sort={sort}
              onSort={setSort}
              view={viewMode}
              onView={chooseView}
              home=""
              onMenuOpenChange={noop}
              // The web board has no view-flip toast (the desktop's Escape layer pops one), so there is
              // nothing to dismiss here.
              onDismissViewHint={noop}
            />
            <div className="flex min-h-0 flex-1">
              <WebRail
                orgSlug={orgSlug}
                starred={Boolean(railFilter.starred)}
                starredCount={starredCount}
                onStarred={() => setRailFilter((f) => ({ ...f, starred: !f.starred }))}
                cards={cards}
                tag={railFilter.tag}
                // The web's rail clears the tag itself (the tag list says "no tag" by passing undefined),
                // so the filter is written directly: the desktop's toggleTag only ever sees a real tag.
                onTag={(next) => setRailFilter((f) => ({ ...f, tag: next }))}
              />
              {web.withAnswers(<BoardSurface
                mode={viewMode}
                columns={COLUMNS}
                byColumn={byColumn}
                allCards={cards}
                expanded={expanded}
                onExpand={(id) => setExpanded((cols) => [...cols, id])}
                renderCard={web.renderCard}
                renderRow={web.renderRow}
                loaded
                filtering={filtering}
                laneState="hidden"
                drag={web.drag}
                onColumnMenu={web.onColumnMenu}
                archive={{
                  count: archivedCount,
                  shown: showArchived,
                  onToggleShown: () => setShowArchived((v) => !v),
                  tip: `Archive all ${web.archive.done.length}`,
                  ...web.archive,
                }}
                review={{ onReviewAll: async () => {}, filter: { errors: false, restart: false }, toggleFilter: noop }}
                onNew={() => setComposing(true)}
                toast={web.toast}
                notify={web.notify}
              />)}
            </div>
          </>
        )}

        {composing && <WebNewCardDialog targets={targets} defaultFolder={project} onSend={board.startCard} onClose={() => setComposing(false)} />}

        {active && activeCard && (
          <WebThreadPanel
            orgId={orgId}
            card={activeCard}
            edits={canReply(active, userId) ? web.editsFor(activeCard) : undefined}
            editTitle={web.renameId === active.card_id}
            onScreenInput={canReply(active, userId) ? screenInput : undefined}
            workerId={lineWorker}
            seed={active.card_id === openCardId ? seed : []}
            shown={shown}
            readOnly={!canReply(active, userId)}
            footer={<WebReplyStatus canReply={canReply(active, userId)} replies={cardReplies(board.commands, active.card_id)} onDrop={(id) => void board.dropCommand(id)} />}
            onClose={board.closeCard}
            onSend={async (text) => {
              const failed = await board.sendReply(active, text);
              if (failed) throw new Error(failed);
            }}
            onAnswer={async (allow, answers, reply, grant) => {
              // With a passkey paired, an Allow is signed on sign.weft.zip, in its own tab: it reads the ask, shows it,
              // signs and sends the answer itself; this board sees the card move on when the Mac has run it.
              if (signer.needs(active, allow, grant)) {
                signer.open(active);
                return;
              }
              const failed = await board.answer(active, allow, answers, reply, grant);
              if (failed) throw new Error(failed);
            }}
          />
        )}
        {web.overlays}
      </div>
      </CloudBlobContext.Provider>
      </ThreadTransportContext.Provider>
    </ToolResultSourceContext.Provider>
  );
}

const noop = () => {};

// N opens New thread, as on the desktop, unless a field has the keys or a modifier is held.
function useNewThreadKey(enabled: boolean, open: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, open]);
}
