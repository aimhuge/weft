import { useState } from "react";
import { api } from "@/lib/client";
import { patchNow, stopNow } from "@/lib/optimistic-cards";
import { cardMenu, columnMenu, resumeCommand, withAccelerators, type CardAction, type ColumnAction } from "@/lib/card-menu";
import { toAccelerator, useShortcutList } from "@/lib/hotkeys";
import { BACKEND_LABELS, type Backend, type Card, type Column, type DevServerStatus, type PermissionMode } from "@/lib/types";
import { useDeleteDialog } from "@/lib/use-delete-dialog";
import { AGENTS, type ThreadAgent } from "@/lib/agents";

// What the board's right-click menus act through: the same functions its buttons, drag and command palette use.
export interface BoardMenuDeps {
  // The Done cards on screen (project filter and search applied), and how many there are archived.
  doneShown: Card[];
  archivedCount: number;
  showArchived: boolean;
  openCard: (card: Card) => void;
  // Opens the card with its title ready to edit.
  renameCard: (card: Card) => void;
  move: (id: string, column: Column) => void;
  toggleArchive: (card: Card) => void;
  // Archives with an Undo toast.
  archive: (cards: Card[]) => void;
  remove: (card: Card) => void;
  // cwd left out, the new-thread dialog picks its usual folder.
  openNew: (cwd?: string) => void;
  toggleArchived: () => void;
  toast: (message: string) => void;
  notify: (err: unknown) => void;
}

// The menus are native (electron/main.cjs). In a plain browser tab there's no shell, so the browser's own menu shows.
export function useBoardMenus(deps: BoardMenuDeps) {
  const shell = typeof window === "undefined" ? undefined : window.weft;
  // Menu items that have a board shortcut use its key, read from the registry: menu item id -> shortcut id.
  // Keys the open menu handles itself (Return, arrows…) are skipped, so card-open shows O, not ↩.
  const shortcuts = useShortcutList();
  // The card whose tags are being edited (Tags…); the board shows components/TagsDialog.tsx for it.
  const [tagging, setTagging] = useState<Card | null>(null);
  // The card whose share link is open (Share…); the board shows components/ShareCardDialog.tsx for it.
  const [sharing, setSharing] = useState<Card | null>(null);
  // The delete confirmation and the card waiting to be deleted (lib/use-delete-dialog.ts).
  const deleteDialog = useDeleteDialog(deps.remove);
  const keys = (map: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(map).map(([item, id]) => {
        const spec = shortcuts.find((s) => s.id === id)?.keys.find((k) => !MENU_OWN_KEYS.test(k));
        return [item, spec && toAccelerator(spec)];
      }),
    );

  async function onCardMenu(card: Card, e: React.MouseEvent) {
    if (!shell?.popupMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const dev = card.review?.dev ? await api.devStatus(card.id).then((r) => r.status, () => null) : null;
    const access = await hasVaultAccess(card);
    const picked = (await shell.popupMenu(withAccelerators(cardMenu(card, dev, access), keys({ open: "card-open", archive: "archive" })))) as CardAction | null;
    if (picked) runCardAction(card, picked).catch(deps.notify);
  }

  // ★ on or off, from the menu or the ☆ on a card or thread. A starred card is never auto-archived.
  function toggleStar(card: Card) {
    const starred = !card.starred;
    patchNow(card.id, { starred }, () => api.mark(card.id, { starred })).catch(deps.notify);
  }

  // Every change in the Tags… dialog saves right away.
  function saveTags(tags: string[]) {
    if (tagging) patchNow(tagging.id, { tags }, () => api.mark(tagging.id, { tags })).catch(deps.notify);
  }

  // Star, Tags… and Share…: true when the action was one of these.
  function runMarkAction(card: Card, action: CardAction) {
    if (action === "star") toggleStar(card);
    else if (action === "tags") setTagging(card);
    else if (action === "share") setSharing(card);
    else return false;
    return true;
  }

  // "Run on <other>" from the right-click menu. Auto-replays the last user message when the card
  // hit a rate limit, so the user doesn't have to do a second click to keep work moving.
  async function runSwitchAction(card: Card, action: CardAction) {
    if (!action.startsWith("switch:")) return false;
    const backend = action.slice(7) as Backend;
    const replay = Boolean(card.rateLimitHit);
    await api.switchBackend(card.id, backend, replay);
    deps.toast(`Switched to ${BACKEND_LABELS[backend]}${replay ? " · replaying last message" : ""}.`);
    return true;
  }

  // "Agent: <name>" — a new soul for the thread; its next message resumes the conversation under it.
  async function runAgentAction(card: Card, action: CardAction) {
    if (!action.startsWith("agent:")) return false;
    const agent = AGENTS[action.slice(6) as ThreadAgent];
    await api.setAgent(card.id, agent.id);
    deps.toast(`“${card.title}” is now the ${agent.name}: its next message starts under the new soul.`);
    return true;
  }

  // "Run /<skill>" — sends a slash command to the card's CLI.
  async function runSkillAction(card: Card, action: CardAction) {
    if (!action.startsWith("skill:")) return false;
    await api.send(card.id, `/${action.slice(6)}`);
    return true;
  }

  // "Move to …" — drags the card to another column.
  function runMoveAction(card: Card, action: CardAction): boolean {
    if (!action.startsWith("move:")) return false;
    deps.move(card.id, action.slice(5) as Column);
    return true;
  }

  // Whether the card has standing 🔐 vault access, or undefined when this shell can't give it (electron/vault-grants.cjs).
  async function hasVaultAccess(card: Card): Promise<boolean | undefined> {
    const vault = shell?.vault;
    if (!vault?.grants || !vault.grant) return undefined;
    return vault.grants().then((all) => all.some((g) => g.card === card.id), () => undefined);
  }

  // "Give 🔐 Vault Access" asks for Touch ID in main; "Revoke" ends every grant the card holds.
  async function runVaultAction(card: Card, action: CardAction) {
    const vault = shell?.vault;
    if (action === "vault:grant" && vault?.grant) {
      const r = await vault.grant(card.cwd, card.id, card.title);
      deps.toast(r.granted ? `“${card.title}” can use ${r.label}'s secrets for an hour without asking.` : `No access given to ${r.label}.`);
      return true;
    }
    if (action === "vault:revoke" && vault?.revoke) {
      await vault.revoke(card.id);
      deps.toast(`“${card.title}” asks again before using a secret.`);
      return true;
    }
    return false;
  }

  // "Permissions: …" — flip the card's mode. Extracted to keep runCardAction's complexity in check.
  async function runModeAction(card: Card, action: CardAction) {
    if (!action.startsWith("mode:")) return false;
    await api.setMode(card.id, action.slice(5) as PermissionMode);
    return true;
  }

  // "Start / Restart / Stop dev server" — runs the card's plan-defined dev command.
  async function runDevAction(card: Card, action: CardAction) {
    if (!action.startsWith("dev:")) return false;
    const { status } = await api.devAction(card.id, action.slice(4) as "start" | "restart" | "stop");
    deps.toast(devMessage(status));
    return true;
  }

  async function runCardAction(card: Card, action: CardAction) {
    if (runMarkAction(card, action)) return;
    if (runMoveAction(card, action)) return;
    if (await runSkillAction(card, action)) return;
    if (await runModeAction(card, action)) return;
    if (await runDevAction(card, action)) return;
    if (await runVaultAction(card, action)) return;
    if (await runSwitchAction(card, action)) return;
    if (await runAgentAction(card, action)) return;
    await runSimpleAction(card, action, shell);
  }

  // The plain menu actions (open, rename, start, stop, reveal, copy, archive, delete): no API, just
  // the deps and shell. Extracted to keep runCardAction's complexity under the cap.
  async function runSimpleAction(card: Card, action: CardAction, shell: typeof window.weft) {
    switch (action) {
      case "open":
        deps.openCard(card);
        return;
      case "rename":
        deps.renameCard(card);
        return;
      case "start":
        deps.move(card.id, "running");
        return;
      case "stop":
        await stopNow(card.id);
        return;
      case "new-here":
        deps.openNew(card.cwd);
        return;
      case "reveal":
        return shell?.revealFolder(card.cwd);
      case "copy-path":
        await navigator.clipboard.writeText(card.cwd);
        deps.toast("Copied the folder path.");
        return;
      case "copy-resume":
        await navigator.clipboard.writeText(resumeCommand(card));
        deps.toast("Copied. Paste it in a terminal to pick the thread up.");
        return;
      case "archive":
        deps.toggleArchive(card);
        return;
      case "delete":
        // Asks first, unless the user ticked "Don't ask again" (lib/use-delete-dialog.ts).
        deleteDialog.ask(card);
        return;
    }
  }

  // Right-clicking a column's empty space; a card's own menu stops the event before it gets here.
  async function onColumnMenu(column: Column, e: React.MouseEvent) {
    if (!shell?.popupMenu) return;
    e.preventDefault();
    const done = deps.doneShown.filter((c) => !c.archived);
    const menu = columnMenu(column, { count: done.length, archived: deps.archivedCount, showArchived: deps.showArchived });
    const picked = (await shell.popupMenu(withAccelerators(menu, keys({ new: "new-thread", "archive-done": "archive-done" })))) as ColumnAction | null;
    if (picked === "new") deps.openNew();
    if (picked === "toggle-archived") deps.toggleArchived();
    if (picked === "archive-done") deps.archive(done);
  }

  // editTags opens the Tags… dialog from elsewhere (the tags in a thread's header).
  return {
    onCardMenu,
    onColumnMenu,
    toggleStar,
    tagging,
    editTags: setTagging,
    saveTags,
    closeTags: () => setTagging(null),
    sharing,
    closeShare: () => setSharing(null),
    shareCard: setSharing,
    // The delete confirmation, already built: the board draws it over its columns.
    deleteDialog: deleteDialog.dialog,
  };
}

// Keys a native menu uses to move and pick, so they can't be an item's key.
const MENU_OWN_KEYS = /^(Enter|Escape|Tab| |Arrow\w+|Home|End)$/;

function devMessage(status: DevServerStatus): string {
  if (status.state === "stopped") return "Dev server stopped.";
  if (status.state === "failed") return "The dev server failed to start; its log is in the review panel.";
  return "Dev server starting…";
}
