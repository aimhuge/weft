import { vi } from "vitest";
import type { SlackChannel, SlackSettings, SlackStatus } from "./slack-types";

// The fakes behind the Slack drawer's hook (lib/use-slack.ts). Shared by lib/use-slack.test.ts and
// lib/use-slack-save.test.ts (a harness is left out of the coverage).
//
// A test file mocks the API client and imports the hook:
//   const apiFetch = vi.hoisted(() => vi.fn());
//   vi.mock("./api-client", () => ({ apiFetch }));
//   const { useSlack } = await import("./use-slack");

export const STATUS: SlackStatus = { signedIn: true, team: "Acme", teamUrl: null, bot: "Weft", socket: "connected", error: null };

export const CHANNELS: SlackChannel[] = [
  { id: "C1", name: "eng", isPrivate: false, isMember: true },
  { id: "C2", name: "secret", isPrivate: true, isMember: false },
];

export const SETTINGS: SlackSettings = {
  channel: "C1",
  channelName: "eng",
  folder: "/dev/app",
  links: [],
  events: { commits: true, pushes: false, deploys: true, status: false, growth: true },
  routes: {},
};

// The server's answer: a body, a status, and a way to read the body.
export function answer(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body), status: ok ? 200 : 500, statusText: "Server Error" };
}

// The mock answers per URL: the settings live at /api/slack, the test message at /api/slack/test and the
// folder's sync at /api/cloud-sync. `override` replaces one of them for a single test.
export const routes: Record<string, () => unknown> = {
  "/api/slack": () => answer({ settings: SETTINGS, folderSynced: false }),
  "/api/slack/test": () => answer({ ok: true, text: "sent" }),
  "/api/cloud-sync": () => answer({ settings: SETTINGS, folderSynced: true }),
};

export function override(url: string, body: unknown, ok = false) {
  routes[url] = () => answer(body, ok);
}

// The board window's bridge to main, as a fake.
export function bridge() {
  return {
    status: vi.fn(() => Promise.resolve(STATUS)),
    setTokens: vi.fn(() => Promise.resolve(STATUS)),
    forgetToken: vi.fn(() => Promise.resolve({ ...STATUS, signedIn: false })),
    channels: vi.fn(() => Promise.resolve(CHANNELS)),
    createChannel: vi.fn((name: string) => Promise.resolve({ id: "C9", name, isPrivate: false, isMember: true })),
  };
}

// The window's bridge, installed for a test that needs one.
export function withBridge(slack: ReturnType<typeof bridge>) {
  (window as unknown as { weft: unknown }).weft = { slack };
  return slack;
}
