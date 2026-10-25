import { vi } from "vitest";

// The fakes behind the Slack card status tests: the board's bus, its cards, the Slack settings and the posting.
// Shared by lib/slack-cards.test.ts and lib/slack-cards-watch.test.ts (a harness is left out of the coverage).
// A test file makes the state with vi.hoisted and mocks the modules:
//   const fake = await vi.hoisted(async () => (await import("./slack-cards.harness")).fakeCards());

export interface CardState {
  listener: null | ((event: { type: string; card: { id: string; column: string } }) => void);
  unsubscribe: ReturnType<typeof vi.fn>;
  cards: { id: string; title: string; cwd: string; column: string }[];
  threads: Record<string, { kind: string; text: string }[]>;
  settings: { channel: string | null; channelName: string | null; folder: string | null; links: { folder: string; channel: string; channelName: string | null }[]; events: { commits: boolean; pushes: boolean; deploys: boolean; status: boolean } };
  known: Record<string, { channel: string; ts: string }>;
  link: string | null;
}

export interface Posted {
  calls: { channel: string; text: string; blocks: unknown[]; thread_ts?: string }[];
  ts: string;
  fail: unknown;
}

export function fakeCards() {
  const state: CardState = {
    listener: null,
    unsubscribe: vi.fn(),
    cards: [],
    threads: {},
    settings: { channel: "C1", channelName: "general", folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } },
    known: {},
    link: null,
  };
  const posted: Posted = { calls: [], ts: "root-1", fail: false };
  return { state, posted };
}
