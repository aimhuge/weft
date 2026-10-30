// The fakes the Weft Worker daemon's tests hand it: an engine that starts cards, a registry that
// answers RPCs, a publisher that records what it was told to publish, and the rows they work on.
import { vi } from "vitest";
import { createDaemon, type Engine } from "./worker-daemon";
import type { GithubStatus } from "./worker-github";
import type { Publisher } from "./worker-publish";
import type { Registry } from "./worker-registry";
import type { Sealed } from "./worker-seal";
import type { Card } from "./types";
import type { CloudCommandRow } from "./cloud-commands";

export const card = (over: Partial<Card> = {}): Card =>
  ({
    id: "card-1",
    title: "Dark mode",
    prompt: "Add dark mode",
    cwd: "/srv/work/weft",
    backend: "claude",
    permissionMode: "acceptEdits",
    column: "run",
    ...over,
  }) as Card;

export const command = (over: Partial<CloudCommandRow> = {}): CloudCommandRow => ({
  id: "cmd-1",
  org_id: "org-1",
  created_by: "u-1",
  kind: "run",
  target_device: "worker:w-1",
  folder: "weft",
  payload: { prompt: "Add dark mode" },
  status: "pending",
  card_id: null,
  error: null,
  created_at: "2026-10-29T10:00:00.000Z",
  updated_at: "2026-10-29T10:00:00.000Z",
  ...over,
});

export function fakeEngine(cards: Record<string, Card> = { "card-1": card() }) {
  const start = vi.fn<(body: Record<string, unknown>) => Promise<Card>>(() => Promise.resolve(card()));
  const reply = vi.fn<(cardId: string, text: string) => void>();
  const answer = vi.fn<(cardId: string, allow: boolean, answers: Record<string, string> | undefined, pendingId: string) => void>();
  const grant = vi.fn<Engine["grant"]>();
  const stop = vi.fn<(cardId: string) => Promise<void>>(() => Promise.resolve());
  const getCard = vi.fn<(cardId: string) => Card | undefined>((id: string) => cards[id]);
  const busy = vi.fn<() => boolean>(() => false);
  const engine: Engine = { start, reply, answer, grant, stop, getCard, busy };
  return { engine, start, reply, answer, grant, stop, getCard, busy };
}

export function fakeReg() {
  const claim = vi.fn<(id: string) => Promise<boolean>>(() => Promise.resolve(true));
  const report = vi.fn<(id: string, status: "done" | "failed", cardId: string | null, error: string | null) => Promise<void>>(
    () => Promise.resolve(),
  );
  const heartbeat = vi.fn<(status: "online" | "busy" | "offline") => Promise<void>>(() => Promise.resolve());
  const pending = vi.fn<() => Promise<CloudCommandRow[]>>(() => Promise.resolve([]));
  const setGithub = vi.fn<(state: string, account: string | null) => Promise<void>>(() => Promise.resolve());
  const reg = { claim, report, heartbeat, pending, setGithub } as unknown as Registry;
  return { reg, claim, report, heartbeat, pending, setGithub };
}

export function fakePublisher() {
  const nameFolder = vi.fn();
  const track = vi.fn();
  const flush = vi.fn(() => Promise.resolve());
  const publisher = { nameFolder, track, flush, hear: vi.fn() } as unknown as Publisher;
  return { publisher, nameFolder, track, flush };
}

export const fakeGithub = () => ({
  login: vi.fn<(sealed: Sealed) => Promise<GithubStatus>>(() => Promise.resolve({ state: "signed_in", account: "octocat" })),
  status: vi.fn<() => Promise<GithubStatus | null>>(() => Promise.resolve({ state: "none", account: null })),
});

// A daemon with everything faked and its own logger.
export function makeDeps(over: Partial<Parameters<typeof createDaemon>[0]> = {}) {
  const reg = fakeReg();
  const eng = fakeEngine();
  const pub = fakePublisher();
  const log = vi.fn();
  const checkout = vi.fn(() => Promise.resolve("/srv/work/weft"));
  const login = vi.fn(() => Promise.resolve());
  const clone = vi.fn<(folder: string, repo: string) => Promise<void>>(() => Promise.resolve());
  const github = fakeGithub();
  const daemon = createDaemon({ reg: reg.reg, engine: eng.engine, publisher: pub.publisher, checkout, login, clone, github, log, ...over });
  return { daemon, ...reg, ...eng, ...pub, log, checkout, login, clone, github };
}
