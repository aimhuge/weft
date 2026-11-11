// A thread transport's shape: where an open thread's data comes from and where its actions go, so the desktop, weft.zip
// and the phone draw one thread view over their own transport. The transports themselves (the desktop's local server,
// a worker's relay, weft.zip's Supabase) and their React hooks are the app's (lib/thread-transport.ts,
// lib/worker-transport.ts, components/web-board/useCloudTransport.ts); `useLive` and `useView` are hooks there, but
// only function types here. Plus the pure pieces a polling transport needs.
import type { UploadedAttachment } from "./attachment";
import type { PermissionMode, SkillInfo } from "./card";
import type { FindMatch } from "./thread-find";
import type { ThreadItem } from "./thread-items";
import { applyThreadEvent, type ThreadPage } from "./thread-page";

// A change to the loaded window, applied to whatever it holds when it lands.
export type PageUpdate = (prev: ThreadPage) => ThreadPage;

// One person the "@" picker offers: in the card's workspace, on its repo, or a GitHub search hit.
export interface MentionPerson {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  kind: "team" | "repo" | "github";
}

export interface ThreadTransport {
  // One page of the thread: the newest (before omitted) or the one ending at index `before`. Null when it can't be read.
  loadPage(cardId: string, before?: number): Promise<ThreadPage | null>;
  // Find over the whole thread, loaded or not (./thread-find.ts). Left out, find covers the loaded window.
  searchThread?: (cardId: string, query: string) => Promise<FindMatch[] | null>;
  // A hook: live changes to this card's thread, and a reconnect (when the caller re-reads the newest page).
  // ...and the reply as it streams where the transport carries it (a worker card's session line, lib/line-host.ts). The
  // desktop's own streaming text comes from the board (lib/board-live.ts), so its transport never calls onStreaming.
  useLive(cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void, onStreaming?: (text: string) => void): void;
  // A hook: the items as they are drawn (the web's blob refs become signed URLs).
  useView(items: ThreadItem[]): ThreadItem[];
  // Interrupt the running turn.
  stop(cardId: string): Promise<void>;
  // Only where the Mac itself runs the card:
  shell?: (cardId: string, command: string) => Promise<void>;
  // Where there's no shell, why: a "!" message still turns the box amber and says this, rather than going to the agent.
  shellRefusal?: string;
  editLast?: (cardId: string, text: string) => Promise<void>;
  // A cold card's next message in a new session of the same card, started from a brief of the thread.
  fresh?: (cardId: string, message: string) => Promise<void>;
  // An outside-folder prompt's "This card" (and the question form's "Read from"); "always" adds it to every card.
  grantFolder?: (cardId: string, directory: string, scope: "card" | "always") => Promise<void>;
  // A database prompt's "Allow safe SQL on this card" (the app's lib/db-calls.ts).
  allowSafeSql?: (cardId: string) => Promise<void>;
  // A Bash prompt's "Auto on this card": the card's permission mode, applied to its running CLI.
  setMode?: (cardId: string, mode: PermissionMode) => Promise<void>;
  waitPermission?: (cardId: string, pendingId: string) => Promise<void>;
  // This first on a held edit: it goes ahead and the card holding the code yields the file (the app's lib/precedence.ts).
  putFirst?: (cardId: string, pendingId: string) => Promise<void>;
  // Others first: the card holding the code goes ahead, and this card waits for it (the app's lib/precedence.ts).
  putHolderFirst?: (cardId: string, pendingId: string) => Promise<void>;
  stopTask?: (cardId: string, taskId: string) => Promise<void>;
  // The card folder's files, so file names in the thread link to the editor column (the app's lib/use-file-index.ts).
  listFiles?: (cardId: string) => Promise<string[]>;
  // The composer's "/" list: the skills of the card's folder on the machine that runs it (the skills.list verb). Off
  // a card (the New thread dialog) there's no cardId, and cwd names the folder. Left out, "/" offers nothing.
  listSkills?: (cardId: string | undefined, cwd: string | undefined) => Promise<SkillInfo[]>;
  // The composer's "@" list: people by GitHub login, the card's workspace and repo first (the app's lib/people-search.ts).
  // Left out, "@" offers nothing. onLocal, when given, hears the people it already holds (workspace, repo) before the
  // slower GitHub search answers, so the list shows at once.
  searchPeople?: (cardId: string | undefined, query: string, onLocal?: (people: MentionPerson[]) => void) => Promise<MentionPerson[]>;
  // Send later: the machine that runs the card holds the message until its time (card.schedule, card.unschedule).
  schedule?: (cardId: string, text: string, at: number) => Promise<unknown>;
  unschedule?: (cardId: string, messageId: string) => Promise<unknown>;
  // A file pasted or dropped in the composer, saved where the message's text can point at it. Left out, the
  // composer says files can't be attached here.
  upload?: (file: Blob, name: string, onProgress?: (fraction: number) => void) => Promise<UploadedAttachment>;
  // A card on another machine: This card and Always go inside the answer, as one command, and that machine works out
  // the folder from its own pending request. "Read from" on a question has no such command, so it isn't offered.
  grantInAnswer?: boolean;
  // The card's own controls in the thread's header reach its host: rename, tags, star, archive and the model picker
  // (the app's lib/project-host.ts). The desktop's always do; a worker card's do too (the app's lib/worker-transport.ts), and so do weft.zip's on your own cards.
  cardEdits?: boolean;
  // The mode picker offers YOLO on a card of another host: a worker card on the desktop app, whose act asks Touch ID
  // for a signed approval of exactly that change (the app's lib/widen-signer.ts). The desktop's own cards always offer it.
  signsSkip?: boolean;
  // The review panel, the skills chip and the copilot's starters: the desktop board's own.
  desktop: boolean;
}

// The newest page laid over what's loaded. A thread that got shorter was rewound on the worker: the page replaces it,
// and so does one that starts past the end of the window (more arrived between polls than a page holds).
export function mergePage(prev: ThreadPage, page: ThreadPage): ThreadPage {
  if (page.total < prev.total || (page.items.length && page.start > prev.start + prev.items.length)) return page;
  return page.items.reduce((next, item, i) => applyThreadEvent(next, { index: page.start + i, item }), prev);
}

// Where the board can't sign (weft.zip, or no Touch ID signer), a "!" says so in the box instead of reaching the agent.
export const SHELL_ELSEWHERE = "A shell runs only on this Mac's cards.";
