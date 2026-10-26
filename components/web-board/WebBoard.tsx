"use client";

// The weft.zip board at /[orgSlug]/board, drawn as the desktop window: the desktop's own BoardHeader, BoardProjectBar,
// BoardColumns and CardView, over the opted-in cards the Macs sync (docs/architecture/cloud-sync.md). The thread in an
// open card is the desktop's own ThreadPanel over the cloud transport (useCloudTransport.ts), so the reply box is the
// desktop's too — the transport leaves out what only the Mac can do, so those views don't offer it.
//
// Server hands it the org id, the initial rows and, with ?card=…, that card's first page of thread; useWebBoard keeps
// them live over Supabase Realtime.
import { useEffect, useMemo, useState } from "react";
import { groupByColumn, summarizeProjects, type SortKey } from "@/lib/board-view";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pageFromRows } from "@/lib/cloud-thread-page";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { useNow } from "@/lib/use-now";
import { useViewMode } from "@/lib/use-view-mode";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import { busyHere } from "@/lib/overlap";
import { COLUMNS, type Column, type ThreadItem } from "@/lib/types";
import { boardCounts, webCards } from "@/lib/web-board";
import { filterCards, isFiltering, type RailFilter } from "@/lib/rail-view";
import { boardCommands, canReply, cardReplies, webTargets } from "@/lib/web-commands";
import BoardHeader from "../BoardHeader";
import BoardProjectBar from "../BoardProjectBar";
import BoardSurface from "../BoardSurface";
import CardRow from "../CardRow";
import CardView from "../CardView";
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

  const cards = useMemo(() => webCards(board.cards), [board.cards]);
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

  const active = board.activeCardId ? board.cards.find((r) => r.card_id === board.activeCardId) : undefined;
  useNewThreadKey(!active && !composing, () => setComposing(true));

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
              <BoardSurface
                mode={viewMode}
                columns={COLUMNS}
                byColumn={byColumn}
                allCards={cards}
                expanded={expanded}
                onExpand={(id) => setExpanded((cols) => [...cols, id])}
                renderCard={(card) => (
                  <CardView key={card.id} readOnly card={card} now={now} selected={card.id === board.activeCardId} alsoHere={busyHere(cards, card)} onOpen={() => board.openCard(card.id)} />
                )}
                renderRow={(card, column, nest) => (
                  <CardRow key={card.id} card={card} column={column} nest={nest} now={now} selected={card.id === board.activeCardId} alsoHere={busyHere(cards, card)} onOpen={() => board.openCard(card.id)} />
                )}
                loaded
                filtering={filtering}
                laneState="hidden"
                drag={{ over: null, setOver: noop, onDrop: noop, onReorder: noop }}
                onColumnMenu={noop}
                archive={{
                  count: archivedCount,
                  shown: showArchived,
                  onToggleShown: () => setShowArchived((v) => !v),
                  done: [],
                  tip: "",
                  cards: noop,
                  restore: noop,
                }}
                review={{ onReviewAll: async () => {}, filter: { errors: false, restart: false }, toggleFilter: noop }}
                onNew={() => setComposing(true)}
                toast={noop}
                notify={noop}
              />
            </div>
          </>
        )}

        {composing && <WebNewCardDialog targets={targets} defaultFolder={project} onSend={board.startCard} onClose={() => setComposing(false)} />}

        {active && (
          <WebThreadPanel
            orgId={orgId}
            card={active.card}
            seed={active.card_id === openCardId ? seed : []}
            shown={shown}
            readOnly={!canReply(active, userId)}
            footer={<WebReplyStatus card={active.card} canReply={canReply(active, userId)} replies={cardReplies(board.commands, active.card_id)} onDrop={(id) => void board.dropCommand(id)} />}
            onClose={board.closeCard}
            onSend={async (text) => {
              const failed = await board.sendReply(active, text);
              if (failed) throw new Error(failed);
            }}
            onAnswer={(allow, answers, reply) => void board.answer(active, allow, answers, reply)}
          />
        )}
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
