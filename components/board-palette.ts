import { api } from "@/lib/client";
import { openChangelog } from "@/lib/changelog-open";
import { openInPane } from "@/lib/open-in-pane";
import { activeAt, recentMoves, SORTERS, type ProjectSummary, type SortKey } from "@/lib/board-view";
import { timeAgo } from "@/lib/format";
import { SCENES, setTheme, THEMES } from "@/lib/theme";
import { replayWelcome } from "@/lib/welcome-client";
import { replayLastAchievement } from "@/lib/achievement-replay";
import { COLUMNS, type Card, type Column } from "@/lib/types";
import { RECENT_MOVE_LIMIT } from "@/lib/palette";
import type { PaletteItem } from "./CommandPalette";
import { folderName, SORTS } from "./ProjectBar";

// What the board's command palette lists (Board.tsx): the cards that just moved, its actions, the projects, and every card.

export interface PaletteState {
  cards: Card[];
  selected: Card | null;
  projectSummaries: ProjectSummary[];
  home: string;
  doneToArchive: Card[];
  lastArchived: string[];
  archivedCount: number;
  showArchived: boolean;
  rootOf: (cwd: string) => string;
  // A restart is waiting for the running threads (lib/restart-when-idle.ts).
  restartArmed?: boolean;
}

export interface PaletteActions {
  openNew: () => void;
  focusFilter: () => void;
  toggleCopilot: () => void;
  toggleBrowser: () => void;
  toggleTerminal: () => void;
  openSettings: () => void;
  // Share board… (components/ShareBoardDialog.tsx): the web board's link and invites.
  shareBoard: () => void;
  openHelp: () => void;
  addSecret: () => void;
  jumpToNeedsYou: () => void;
  archiveCards: (list: Card[]) => void;
  unarchive: (ids: string[]) => void;
  toggleShowArchived: () => void;
  chooseSort: (sort: SortKey) => void;
  focusReply: () => void;
  closeThread: () => void;
  toggleArchive: (card: Card) => void;
  stop: (id: string) => void;
  move: (id: string, column: Column) => void;
  chooseProject: (path: string | null) => void;
  openCard: (card: Card) => void;
  // Shows a message in the board's toast (Import GitHub issues reports its counts there).
  toast?: (text: string) => void;
}

const command = (id: string, label: string, icon: PaletteItem["icon"], run: () => void, keys?: string, keywords?: string) =>
  ({ id: `cmd-${id}`, group: "Commands", label, icon, run, keys, keywords }) satisfies PaletteItem;

// The open thread's project, or the most recent one: its open GitHub issues become Backlog cards (lib/github-issues.ts).
function importIssuesItem(s: PaletteState, a: PaletteActions): PaletteItem[] {
  const folder = s.selected ? s.rootOf(s.selected.cwd) : s.projectSummaries[0]?.path;
  if (!folder) return [];
  const name = folderName(folder);
  const run = () =>
    void api.importIssues(folder).then(
      (r) => a.toast?.(`GitHub issues for ${name}: ${r.added} new, ${r.updated} updated, ${r.archived} archived. Checking again every 5 minutes.`),
      (err: unknown) => a.toast?.(err instanceof Error ? err.message : String(err)),
    );
  return [command("import-issues", `Import GitHub issues into ${name}`, "github", run, undefined, "github issues backlog sync")];
}

// The open thread's project, or the most recent one: what its threads shipped (components/ChangelogDialog.tsx).
function changelogItem(s: PaletteState): PaletteItem[] {
  const folder = s.selected ? s.rootOf(s.selected.cwd) : s.projectSummaries[0]?.path;
  if (!folder) return [];
  return [command("changelog", `Changelog of ${folderName(folder)}`, "list", () => openChangelog(folder), undefined, "changelog release notes shipped version")];
}

// Restart when idle (lib/restart-when-idle.ts), or cancel the one that's waiting.
function restartItem(s: PaletteState, a: PaletteActions): PaletteItem {
  const fail = (err: unknown) => a.toast?.(err instanceof Error ? err.message : String(err));
  if (s.restartArmed) return command("restart-cancel", "Cancel the restart", "x", () => void api.cancelRestart().catch(fail), undefined, "relaunch");
  const run = () => void api.restartWhenIdle().catch(fail);
  return command("restart", "Restart Weft when idle", "reload", run, undefined, "relaunch reload quit update wait finish");
}

// Your team on weft.zip (lib/teams.ts): the pane owns the web session cookie, so opening it in the pane
// keeps the sign-in round trip local; outside the desktop, openExternal opens a new tab in the system browser.
// weft.zip spelled out here: importing SITE from lib/home pulls its server-only "use cache" code into the board.
export function openTeamPage() {
  openWeftPage("https://weft.zip/team");
}

// Any weft.zip page (the team, a workspace's web board) in the pane, else the system browser.
export function openWeftPage(url: string) {
  openInPane(url);
}

function commandItems(s: PaletteState, a: PaletteActions): PaletteItem[] {
  const { doneToArchive, lastArchived, archivedCount, selected } = s;
  const commands: PaletteItem[] = [
    command("new", "New thread", "plus", a.openNew, "n"),
    command("filter", "Filter cards", "search", a.focusFilter, "/"),
    command("copilot", "Open or close the copilot", "sparkles", a.toggleCopilot, "c"),
    command("browser", "Toggle the browser", "globe", a.toggleBrowser, "b"),
    command("terminal", "Toggle the terminal", "terminal", a.toggleTerminal, "t", "shell console command line"),
    command("settings", "Open settings", "sliders", a.openSettings, ","),
    command("help", "Show keyboard shortcuts", "zap", a.openHelp, "?", "hotkeys keys"),
    command("add-secret", "Add a secret", "lock", a.addSecret, "shift+s", "vault env key token password"),
    command("needs-you", "Jump to a card that needs you", "alert", a.jumpToNeedsYou, "a", "waiting"),
    command("share-board", "Share the board…", "share", a.shareBoard, undefined, "share invite web board weft.zip team link"),
    command("team", "Your team", "globe", openTeamPage, undefined, "team members invite workspace weft.zip"),
    command("replay-welcome", "Replay the welcome", "play", replayWelcome, undefined, "onboarding intro first launch tour"),
    command("replay-achievement", "Replay last achievement", "sparkles", replayLastAchievement, undefined, "level up badge celebration episode"),
    ...importIssuesItem(s, a),
    ...changelogItem(s),
    restartItem(s, a),
    ...(doneToArchive.length
      ? [command("archive-done", `Archive all ${doneToArchive.length} in Done`, "archive", () => a.archiveCards(doneToArchive), "shift+e", "clear file")]
      : []),
    ...(lastArchived.length ? [command("archive-undo", "Undo the last archive", "archive", () => a.unarchive(lastArchived), "shift+z", "unarchive restore")] : []),
    ...(archivedCount
      ? [command("toggle-archived", `${s.showArchived ? "Hide" : "Show"} ${archivedCount} archived`, "archive", a.toggleShowArchived)]
      : []),
    ...SORTS.map((o) => command(`sort-${o.id}`, `Sort: ${o.label}`, "list", () => a.chooseSort(o.id), undefined, "order")),
    ...THEMES.map((t) => command(`theme-${t.id}`, `Theme: ${t.label}`, "sun", () => setTheme(t.id), undefined, "appearance dark light")),
    ...SCENES.map((t) => command(`theme-${t.id}`, `Theme: ${t.label}`, "sun", () => setTheme(t.id), undefined, "appearance scene background picture")),
  ];
  if (selected) {
    commands.unshift(
      command("reply", "Reply in the open thread", "send", a.focusReply, "r"),
      command("close", "Close the open thread", "x", a.closeThread, "Escape"),
      command("archive", selected.archived ? "Unarchive the open thread" : "Archive the open thread", "archive", () => a.toggleArchive(selected), "shift+a", "file"),
      ...(selected.column === "running" ? [command("stop", "Stop the open thread", "stop", () => a.stop(selected.id))] : []),
      ...COLUMNS.filter((c) => c.id !== selected.column).map((c) =>
        command(`move-${c.id}`, `Move the open thread to ${c.label}`, "forward", () => a.move(selected.id, c.id)),
      ),
    );
  }
  return commands;
}

export function boardPaletteItems(s: PaletteState, a: PaletteActions): PaletteItem[] {
  const { home } = s;
  const projectItems = [null, ...s.projectSummaries.map((p) => p.path)].map((path): PaletteItem => ({
    id: `project-${path ?? "all"}`,
    group: "Projects",
    label: path ? folderName(path) : "All projects",
    detail: path ? (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path) : undefined,
    keywords: "project folder",
    icon: "folder",
    project: path ? folderName(path) : undefined,
    run: () => a.chooseProject(path),
  }));
  const now = Date.now();
  const cardItem = (card: Card): PaletteItem => ({
    id: `card-${card.id}`,
    cardId: card.id,
    group: "Cards",
    label: card.title,
    project: folderName(card.cwd),
    column: card.column,
    root: s.rootOf(card.cwd),
    keywords: [card.prompt, card.lastLine, card.stage, card.remaining, folderName(card.cwd)].filter(Boolean).join(" "),
    preview: (card.error || card.lastLine)?.replace(/\s+/g, " ").trim() || undefined,
    when: timeAgo(activeAt(card), now),
    icon: "file",
    run: () => a.openCard(card),
  });
  const cardItems = s.cards.filter((c) => c.role !== "copilot").toSorted(SORTERS.active).map(cardItem);
  // Shown only before you type; the same cards still match a search under Cards.
  const movedItems = recentMoves(s.cards, now, RECENT_MOVE_LIMIT).map((card): PaletteItem => ({
    ...cardItem(card),
    id: `moved-${card.id}`,
    group: "Recently changed",
    when: timeAgo(card.columnAt ?? now, now),
  }));
  return [...movedItems, ...commandItems(s, a), ...projectItems, ...cardItems];
}

// The prompts the user wrote that matched a search, as palette items that open their card.
export function promptItems(
  hits: { cardId: string; snippet: string }[],
  cards: Card[],
  rootOf: (cwd: string) => string,
  openCard: (card: Card) => void,
): PaletteItem[] {
  return hits.flatMap((hit, i): PaletteItem[] => {
    const card = cards.find((c) => c.id === hit.cardId);
    if (!card) return [];
    return [
      {
        id: `prompt-${hit.cardId}-${i}`,
        group: "Prompts",
        label: card.title,
        project: folderName(card.cwd),
        column: card.column,
        root: rootOf(card.cwd),
        snippet: hit.snippet.replace(/\s+/g, " "),
        when: timeAgo(activeAt(card), Date.now()),
        icon: "file",
        run: () => openCard(card),
      },
    ];
  });
}
