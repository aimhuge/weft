// Type shim for ./sim-live.cjs so its test gets real types instead of `any`. Only TS reads this.

import type { OwnsPane, ServerAccessor } from "./app-setup.d.cts";

export type Source = { id: string; name: string };
export type SourceResult = { ok: true; id: string; name: string } | { ok: false; reason: "permission" | "no-window" };
export type InputBody = { kind: "tap" | "swipe" | "live"; device: string; x?: number; y?: number; x2?: number; y2?: number; ms?: number };
export type Apis = {
  desktopCapturer: { getSources: (opts: unknown) => Promise<Source[]> };
  systemPreferences: { getMediaAccessStatus?: (kind: string) => string };
};
type Fetch = (url: URL, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;
type Event = { sender: { getURL: () => string } };

export const INPUT_PATH: string;
export function pickWindow(sources: Source[], deviceName: string): Source | null;
export function onViewerPage(dataDir: string, event: Event): boolean;
export function findSource(apis: Apis, deviceName: string): Promise<SourceResult>;
export function cleanInput(raw: unknown): InputBody;
export function sendInput(deps: { server: ServerAccessor | (() => null); fetch: Fetch }, raw: unknown): Promise<{ ok: boolean; error?: string }>;
export function setupSimLive(opts: {
  ipcMain: { handle: (channel: string, fn: (event: unknown, arg: unknown) => unknown) => void };
  owns: OwnsPane;
  dataDir: string;
  server: ServerAccessor;
  apis?: () => Apis;
  fetch?: Fetch;
}): void;
