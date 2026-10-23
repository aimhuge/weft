"use client";

// The weft.zip board at /[orgSlug]/board, laid out like the desktop window: its header (WebBoardHeader), the project
// bar, the 38px rail beside the columns (WebRail), the desktop's own BoardColumn and CardView drawn read-only from the
// opted-in cards the Macs sync (docs/architecture/cloud-sync.md), and a card opening framed with its browser pane
// (WebThreadPanel), where the thread is the desktop's own ThreadPanel over the cloud transport (useCloudTransport.ts).
// Server hands it the org id, the initial rows and, with ?card=…, that card's first page of thread; useWebBoard keeps
// them live over Supabase Realtime.
import { useEffect, useMemo, useState } from "react";
import { groupByColumn, summarizeProjects, type SortKey } from "@/lib/board-view";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pageFromRows } from "@/lib/cloud-thread-page";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { useNow } from "@/lib/use-now";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import { busyHere } from "@/lib/overlap";
import { COLUMNS, type Column, type ThreadItem } from "@/lib/types";
import { boardCounts, webCards } from "@/lib/web-board";
import { boardCommands, canReply, cardReplies, webTargets } from "@/lib/web-commands";
import BoardColumn, { COLUMN_LIMIT } from "../BoardColumn";
import CardView from "../CardView";
import { WebAccountMenu, type WebOrg, type WebUser } from "./WebAccountMenu";
import { WebBoardHeader } from "./WebBoardHeader";
import { WebShareBoard } from "./WebShareBoard";
import { useWebBoard } from "./useWebBoard";
import { WebCommandStrip } from "./WebCommandStrip";
import { WebNewCardDialog } from "./WebNewCardDialog";
import { WebProjectBar } from "./WebProjectBar";
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
  const [project, setProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Column[]>([]);
  const [composing, setComposing] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);

  const cards = useMemo(() => webCards(board.cards), [board.cards]);
  const starredCount = cards.filter((c) => c.starred).length;
  const byColumn = useMemo(
    () => groupByColumn(starredOnly ? cards.filter((c) => c.starred) : cards, { project, query, sort, showArchived }, identity),
    [cards, starredOnly, project, query, sort, showArchived],
  );
  const projects = useMemo(() => summarizeProjects([], cards, identity), [cards]);
  const { running, waiting } = boardCounts(cards);
  const targets = useMemo(() => webTargets(board.cards, userId), [board.cards, userId]);
  const archivedCount = cards.filter((c) => c.archived).length;
  const filtering = project !== null || query.trim() !== "" || starredOnly;

  const active = board.activeCardId ? board.cards.find((r) => r.card_id === board.activeCardId) : undefined;
  useNewThreadKey(!active && !composing, () => setComposing(true));

  return (
    <ToolResultSourceContext.Provider value={board.toolOutput}>
      <ThreadTransportContext.Provider value={board.transport}>
      <CloudBlobContext.Provider value={blobs}>
      <div className="wz-desk" data-theme="dark">
        <WebBoardHeader
          workspace={orgs.find((o) => o.id === orgId)?.name || orgSlug}
          running={running}
          waiting={waiting}
          live={board.live}
          onOpenNew={() => setComposing(true)}
          share={<WebShareBoard orgSlug={orgSlug} />}
          account={<WebAccountMenu user={user} orgs={orgs} orgSlug={orgSlug} />}
        />
        <WebCommandStrip commands={boardCommands(board.commands)} onDrop={(id) => void board.dropCommand(id)} />

        {cards.length === 0 ? (
          <p className="m-6 rounded-lg border border-line bg-sunken p-6 text-[13.5px] leading-relaxed text-muted">
            No synced cards yet. Cards show here once you turn on Sync for a project in the Weft desktop app (<strong className="text-ink">Settings → Sync</strong>).
          </p>
        ) : (
          <>
            <WebProjectBar projects={projects} total={cards.length} selected={project} onSelect={setProject} query={query} onQuery={setQuery} sort={sort} onSort={setSort} />
            <div className="flex min-h-0 flex-1">
              <WebRail orgSlug={orgSlug} starred={starredOnly} starredCount={starredCount} onStarred={() => setStarredOnly((v) => !v)} />
              <main className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3">
                {COLUMNS.map((column) => {
                  const list = byColumn.get(column.id) ?? [];
                  return (
                    <BoardColumn
                      key={column.id}
                      column={column}
                      shown={expanded.includes(column.id) ? list : list.slice(0, COLUMN_LIMIT)}
                      count={list.length}
                      loaded
                      filtering={filtering}
                      dragOver={false}
                      laneState="hidden"
                      onShowMore={() => setExpanded((cols) => [...cols, column.id])}
                      renderCard={(card) => (
                        <CardView key={card.id} readOnly card={card} now={now} selected={card.id === board.activeCardId} alsoHere={busyHere(cards, card)} onOpen={() => board.openCard(card.id)} />
                      )}
                      onDragOver={noop}
                      onDragLeave={noop}
                      onDrop={noop}
                      onColumnContextMenu={noop}
                      needsYou={column.id === "needs_you" && list.length > 0}
                      archivedCount={archivedCount}
                      showArchived={showArchived}
                      onToggleArchived={() => setShowArchived((v) => !v)}
                      toArchive={0}
                      archiveTip=""
                      onArchiveAll={noop}
                      onAddBacklog={() => setComposing(true)}
                    />
                  );
                })}
              </main>
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
