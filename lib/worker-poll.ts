// How an open worker thread is polled over the relay (docs/architecture/project-hosts.md#cost-and-speed). It asks only for
// items past what the board has, polls fast while the card runs or waits on you and slowly when it's idle, stops while
// the window is hidden and reads once on return. H6's WebRTC line makes this the fallback.
import type { Card } from "./types";
import type { ThreadPage } from "./thread-page";
import { parseWorkerProject } from "./worker-project";
import { noteRelay } from "./worker-route";

const UNKNOWN_WORKER = "?";

export const THREAD_POLL_MS = 2_500;
export const THREAD_IDLE_POLL_MS = 30_000;

// Whether each card runs or waits on you, and the worker it is on. The board hook fills this from each read; a card it
// hasn't seen counts as active.
let states = new Map<string, { active: boolean; worker: string }>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

export function setActiveCards(cards: readonly Pick<Card, "id" | "column" | "cwd">[]) {
  const next = new Map(cards.map((c) => [c.id, { active: c.column === "running" || c.column === "needs_you", worker: parseWorkerProject(c.cwd)?.workerId ?? UNKNOWN_WORKER }]));
  const flipped = [...next].some(([id, s]) => s.active !== (states.get(id)?.active ?? true));
  states = next;
  if (flipped) notify();
}

export const isActiveCard = (cardId: string) => states.get(cardId)?.active ?? true;

// The worker a card is on, for its route note (lib/worker-route.ts).
export const workerOfCard = (cardId: string) => states.get(cardId)?.worker ?? UNKNOWN_WORKER;

// A reply or a command just went to this card: poll it fast now, before the next board read says it runs.
export function wakeCard(cardId: string) {
  const known = states.get(cardId);
  if (known?.active) return;
  states = new Map(states).set(cardId, { active: true, worker: known?.worker ?? UNKNOWN_WORKER });
  notify();
}

export function clearActiveCards() {
  states = new Map();
}

// A whole board read happened (lib/use-worker-board.ts): every open thread reads its whole newest page once, which
// catches an earlier item edited in place.
let epoch = 0;
export function markWholeRead() {
  epoch++;
}

// Every this-many fast polls the thread reads its whole newest page, for the same reason.
export const WHOLE_PAGE_EVERY = 10;

interface ThreadPoll {
  cardId: string;
  // The page past `after` (the whole newest page with none); null when it can't be read.
  fetchPage: (after?: number) => Promise<ThreadPage | null>;
  apply: (page: ThreadPage) => void;
}

// The seq to ask past: `back` before the last item the loop has, or none (the whole newest page) when it has nothing yet.
const afterSeq = (known: number | undefined, back: number, whole: boolean) => (whole || known === undefined || known - back < 0 ? undefined : known - back);

// An empty answer shorter than what the board has: the thread was rewound.
const rewound = (page: ThreadPage, known: number | undefined) => known !== undefined && page.total < known && !page.items.length;

const hidden = () => typeof document !== "undefined" && document.hidden;

// Starts the loop; returns its stop.
export function startThreadPoll({ cardId, fetchPage, apply }: ThreadPoll): () => void {
  // The total of the last page this loop saw; undefined until the first full read.
  let known: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let fast = 0;
  let seenEpoch = epoch;
  let wasActive = isActiveCard(cardId);
  let stopped = false;
  const live = () => !stopped;

  const schedule = () => {
    clearTimeout(timer);
    if (stopped || hidden()) return;
    timer = setTimeout(() => void run(), isActiveCard(cardId) ? THREAD_POLL_MS : THREAD_IDLE_POLL_MS);
  };

  // `settle` is the one more read after a card goes idle, which re-asks the last item as a running card's poll does.
  const run = async (settle = false) => {
    if (inFlight || stopped || hidden()) return;
    inFlight = true;
    try {
      const running = isActiveCard(cardId);
      // A running card's last item can still change in place (a tool's result arrives), so it is asked for again.
      const back = running || settle ? 2 : 1;
      const whole = seenEpoch !== epoch || (running && ++fast % WHOLE_PAGE_EVERY === 0);
      seenEpoch = epoch;
      const after = afterSeq(known, back, whole);
      const started = Date.now();
      let page = await fetchPage(after);
      if (page) noteRelay(workerOfCard(cardId), Date.now() - started);
      // A rewound thread is read again, the newest page whole.
      if (page && rewound(page, known)) page = await fetchPage();
      if (page && live()) {
        known = page.total;
        apply(page);
      }
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const onVisible = () => {
    if (hidden()) return;
    clearTimeout(timer);
    void run();
  };
  // A card that starts running while the loop waits its slow 30 s is read at the fast pace from then on; one that goes
  // idle gets a last read, so its final in-place edit isn't missed.
  const onActive = () => {
    const running = isActiveCard(cardId);
    if (running === wasActive) return;
    wasActive = running;
    if (running) {
      if (!inFlight) schedule();
    } else void run(true);
  };

  listeners.add(onActive);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    listeners.delete(onActive);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
