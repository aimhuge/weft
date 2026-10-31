// Shared by lib/cloud-inbox*.test.ts: a stand-in for the account's Supabase client (the cloud_commands table
// answers from `db`, the Realtime channel hands its handlers to the test, the session says who is signed in)
// and the modules the inbox leans on. The test files mount these through vi.mock factories.
import { vi } from "vitest";
import type { CloudCommandRow } from "./cloud-commands";

type Filters = [string, unknown][];

export const db = {
  pending: [] as CloudCommandRow[],
  selectError: null as string | null,
  claim: true,
  claimError: null as string | null,
  reportError: null as string | null,
  updates: [] as { patch: Record<string, unknown>; filters: Filters }[],
  selects: [] as Filters[],
  user: "u1" as string | null,
  channels: [] as { name: string; filter: string; nudge: () => void; status: (s: string) => void }[],
  removed: 0,
  authListener: null as null | (() => void),
  unsubscribed: 0,
};

function table() {
  let update: Record<string, unknown> | null = null;
  let claiming = false;
  const filters: Filters = [];
  const builder: Record<string, unknown> = {
    select: () => {
      if (update) claiming = true;
      return builder;
    },
    update: (patch: Record<string, unknown>) => {
      update = patch;
      db.updates.push({ patch, filters });
      return builder;
    },
    eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
    order: () => builder,
    limit: () => builder,
    overrideTypes: () => (db.selects.push(filters), builder),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        update === null
          ? { data: db.pending, error: db.selectError ? { message: db.selectError } : null }
          : claiming
            ? { data: db.claim ? [{ id: "x" }] : [], error: db.claimError ? { message: db.claimError } : null }
            : { error: db.reportError ? { message: db.reportError } : null },
      ).then(resolve),
  };
  return builder;
}

export const client = {
  from: () => table(),
  auth: {
    getSession: () => Promise.resolve({ data: { session: db.user ? { user: { id: db.user } } : null } }),
    onAuthStateChange: (cb: () => void) => {
      db.authListener = cb;
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              db.unsubscribed++;
            },
          },
        },
      };
    },
  },
  channel: (name: string) => {
    const entry = { name, filter: "", nudge: () => {}, status: (() => {}) as (status: string) => void };
    db.channels.push(entry);
    const channel = {
      on: (_type: string, cfg: { filter: string }, cb: () => void) => {
        entry.filter = cfg.filter;
        entry.nudge = cb;
        return channel;
      },
      subscribe: (cb: (status: string) => void) => {
        entry.status = cb;
        return channel;
      },
    };
    return channel;
  },
  removeChannel: () => {
    db.removed++;
    return Promise.resolve();
  },
};

// What the mocked modules answer with; a test changes these.
export const control = {
  account: (): unknown => client,
  folders: ["/dev/app"],
  org: "org1" as string | null,
  made: [] as Record<string, unknown>[],
  createCardFromBody: vi.fn((body: Record<string, unknown>): { id: string } => {
    control.made.push(body);
    return { id: "card-1" };
  }),
  startCard: vi.fn<(card: unknown) => void>(),
  syncNow: vi.fn<() => void>(),
  // The cards on this Mac, for a reply to find its thread.
  cards: new Map<string, { id: string; cwd: string; role?: string; readScope?: string[]; pending?: unknown }>(),
  sendUserMessage: vi.fn<(cardId: string, text: string) => void>(),
  // Calls a reply routes through sendUserMessage; answer/stop go through their own.
  answered: [] as { cardId: string; allow: boolean; answers?: Record<string, string>; pendingId?: string; reply?: unknown }[],
  answerPermission: vi.fn<(cardId: string, allow: boolean, answers?: Record<string, string>, pendingId?: string, reply?: unknown) => void>(),
  // Folders an Always added to this Mac's settings.
  allowed: [] as string[],
  stopped: [] as string[],
  stop: vi.fn<(cardId: string) => Promise<void>>(),
};

export const accountMock = { accountClient: () => control.account() };
export const settingsMock = { syncFolders: () => [...control.folders], allowFolder: (folder: string) => control.allowed.push(folder) };
export const deviceMock = { deviceId: () => "mac-1" };
export const cloudSyncMock = { syncNow: () => control.syncNow(), syncOrgId: () => Promise.resolve(control.org) };
export const newCardMock = {
  createCardFromBody: (body: Record<string, unknown>) => control.createCardFromBody(body),
  startCard: (card: unknown) => control.startCard(card),
};

export const runnerMock = {
  sendUserMessage: (cardId: string, text: string) => control.sendUserMessage(cardId, text),
  answerPermission: (cardId: string, allow: boolean, answers?: Record<string, string>, pendingId?: string, reply?: unknown) => {
    control.answered.push({ cardId, allow, answers, pendingId, reply });
    control.answerPermission(cardId, allow, answers, pendingId, reply);
  },
  stop: (cardId: string) => {
    control.stopped.push(cardId);
    return control.stop(cardId);
  },
};
export const storeMock = {
  getCard: (id: string) => control.cards.get(id),
  updateCard: (id: string, patch: { readScope?: string[] }) => {
    const card = control.cards.get(id);
    if (card) control.cards.set(id, { ...card, ...patch });
  },
};

export const command = (over: Partial<CloudCommandRow> = {}): CloudCommandRow => ({
  id: "cmd-1",
  org_id: "org1",
  created_by: "u1",
  kind: "new_card",
  target_device: "mac-1",
  folder: "/dev/app",
  payload: { prompt: "Add dark mode", model: "claude-opus-5-5", backend: "claude" },
  status: "pending",
  card_id: null,
  error: null,
  created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T00:00:00Z",
  ...over,
});

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The reports a run sent back (the claim is the update that filters on status).
export const reports = () => db.updates.filter((u) => !u.filters.some(([k]) => k === "status")).map((u) => u.patch);

// A clean slate: nobody's state carries into the next test.
export function resetInbox() {
  delete (globalThis as Record<string, unknown>).__weftCloudInbox;
  Object.assign(db, { pending: [], selectError: null, claim: true, claimError: null, reportError: null, user: "u1", removed: 0, authListener: null, unsubscribed: 0 });
  db.updates.length = 0;
  db.selects.length = 0;
  db.channels.length = 0;
  control.made.length = 0;
  beats.length = 0;
  control.cards.clear();
  control.folders = ["/dev/app"];
  control.org = "org1";
  control.account = () => client;
  control.answered.length = 0;
  control.allowed.length = 0;
  control.stopped.length = 0;
  vi.clearAllMocks();
}

// Opens the channel the way the app does, then lets the SUBSCRIBED drain run.
export async function listening(refresh: () => Promise<void>) {
  await refresh();
  db.channels[0]?.status("SUBSCRIBED");
  await settle();
}

// The desktop worker's heartbeat (lib/desktop-worker.ts): recorded, never sent.
export const beats: string[] = [];
export const desktopWorkerMock = {
  beatDesktopWorker: (_client: unknown, uid: string) => {
    beats.push(uid);
    return Promise.resolve();
  },
};
