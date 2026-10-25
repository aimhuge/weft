// The board's view of Electron's shell (browser pane, terminal, vault, account, etc.)
// as exposed by electron/preload.cjs; the `weft` global on `window`.

import type { MeterBalance } from "@aimhuge/billing";
import type { MenuItem } from "./card-menu";
import type { PlanId } from "./billing/plans";
import type { VaultBridge } from "./vault-view";
import type { VercelBridge } from "./vercel-view";
import type { SupabaseBridge } from "./supabase-view";
import type { BlastcpBridge } from "./blastcp-view";
import type { CloudflareBridge } from "./cloudflare-view";
import type { SlackBridge } from "./slack-types";
import type { GooseBridge } from "./goose-provider";

export interface BrowserState {
  visible: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  // The page's zoom, in percent. A shell from before zoom reporting sends none.
  zoom?: number;
}

// What the app menu, dock, tray, global shortcuts and weft:// links ask a window to do.
// open-card carries an id.
export type MenuAction = "new-thread" | "settings" | "open-card" | "find" | "terminal" | "add-webhook";

// The board's view of the signed-in user's billing (docs/architecture/billing.md). Mirrors the JSON the local
// /api/account/billing route returns, kept client-side so React components don't pull in server-only modules.
export interface BillingStatusView {
  org: { slug: string; name: string };
  plan: { id: PlanId; name: string };
  status: string;
  interval: "monthly" | "yearly" | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  puku: MeterBalance | null;
  manageUrl: string;
}
export type BillingClientView = BillingStatusView | { error: string } | null;

// Exposed by electron/preload.cjs; absent when the board runs in a normal browser tab.
export interface ShellBridge {
  desktop: true;
  // process.platform, e.g. "darwin".
  platform: string;
  // The page's zoom factor, 1 at Actual Size.
  zoomFactor?(): number;
  browser: {
    // key is the card whose browser to load into; each card has its own, and the open card's is on screen.
    open(url: string, key?: string): Promise<unknown>;
    // Shows a card's browser, or the board's own with no card open.
    setActive(key: string | null): void;
    // Closes the browsers of cards not in keys.
    prune(keys: string[]): void;
    getState(): Promise<BrowserState>;
    setVisible(visible: boolean): void;
    setBounds(rect: { x: number; y: number; width: number; height: number }): void;
    back(): void;
    forward(): void;
    reload(): void;
    // "in", "out", "reset", or a percentage.
    zoom(action: "in" | "out" | "reset" | number): void;
    onState(callback: (state: BrowserState) => void): () => void;
  };
  dialog: {
    // A native folder picker; resolves to null when cancelled.
    openFolder(): Promise<string | null>;
  };
  // Opens an http(s) URL in the default browser.
  openExternal(url: string): void;
  // Opens a local folder in Finder.
  revealFolder(folder: string): void;
  // A native context menu at the pointer (lib/card-menu.ts); resolves to the picked id, or null.
  popupMenu(items: MenuItem[]): Promise<string | null>;
  // The dock badge, e.g. how many cards need the user.
  setBadge(count: number): void;
  // Keep Working (electron/keep-working.cjs). Settings → Laptop mode uses this. Missing on
  // non-macOS and in shells that don't expose it. auto: "Always while threads run"; minBattery: the % sleep
  // comes back at; onlineOnly: sleep comes back once the Mac is offline.
  keepWorking?: {
    state(): Promise<{
      mode: "off" | "threads" | "hours";
      hours?: number;
      until?: number;
      running?: number | null;
      auto?: boolean;
      minBattery?: number;
      onlineOnly?: boolean;
    }>;
    start(mode: "threads" | "hours", hours?: number): Promise<void>;
    stop(): Promise<void>;
    setPrefs?(patch: { auto?: boolean; minBattery?: number; onlineOnly?: boolean }): Promise<void>;
    onChange(callback: () => void): () => void;
  };
  copilot: {
    toggle(): void;
    onState(callback: (state: { open: boolean }) => void): () => void;
  };
  // Shells for the terminal drawer, keyed by id. open reattaches to a running one and replays its output.
  terminal: {
    open(id: string, cwd: string, cols: number, rows: number): Promise<{ replay?: string; cwd?: string; error?: string }>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    onData(callback: (id: string, data: string) => void): () => void;
    onExit(callback: (id: string, code: number) => void): () => void;
  };
  // The secrets vault in Electron main (lib/vault-view.ts). Missing in older shells.
  vault?: VaultBridge;
  // Vercel in Electron main (lib/vercel-view.ts). Missing in older shells.
  vercel?: VercelBridge;
  // Supabase in Electron main (lib/supabase-view.ts). Missing in older shells.
  supabase?: SupabaseBridge;
  // BlastCP in Electron main (lib/blastcp-view.ts). Missing in older shells.
  blastcp?: BlastcpBridge;
  // Cloudflare in Electron main (lib/cloudflare-view.ts). Missing in older shells.
  cloudflare?: CloudflareBridge;
  // Slack in Electron main (lib/slack-types.ts): the tokens and the Socket Mode connection. Missing in older shells.
  slack?: SlackBridge;
  // Goose's provider keys in Electron main (lib/goose-provider.ts). Missing in older shells. The board sends a key
  // once and never reads one back.
  goose?: GooseBridge;
  onMenu(callback: (action: MenuAction, payload?: string) => void): () => void;
  // The board's first cards are on screen; resolves to this launch's timing. Missing in older shells.
  startupReady?(): Promise<StartupResult>;
  // The startup screen's buttons; "relaunch" restarts Weft (a shell from before it ignores it). Missing in older shells.
  splashAction?(action: "retry" | "logs" | "quit" | "relaunch"): void;
  // Hosted mini apps: the Share dialog's "Upload secrets" pushes the manifest's author secrets
  // and public names to weft.zip behind Touch ID (electron/app-secrets-push.cjs). Missing in
  // older shells.
  appSecrets?: {
    push(appId: string): Promise<{ ok: true; pushed: string[]; missing?: string[] } | { error: string }>;
  };
}

// One launch's timing from electron/startup-timer.cjs: usual is the median of recent launches (null until
// there are a few), slowest is the longest phase.
export interface StartupResult {
  total: number;
  usual: number | null;
  slow: boolean;
  slowest: { name: string; label: string; ms: number };
}

declare global {
  interface Window {
    weft?: ShellBridge;
  }
}
