// Shared stand-ins for the updater's tests (updater.test.ts, updater-quiet.test.ts).
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import { createUpdater } from "./updater.cjs";

export function feed(version: string, notes = "### Added\n- things") {
  return {
    currentRelease: version,
    releases: [{ version, updateTo: { version, notes, url: `https://example.test/Weft-${version}-arm64.zip` } }],
    page: `https://example.test/releases/tag/v${version}`,
  };
}

// Squirrel stand-in: records the feed it was given and lets a test fire its events.
export function fakeSquirrel() {
  const emitter = new EventEmitter() as EventEmitter & Record<string, ReturnType<typeof vi.fn>>;
  emitter.setFeedURL = vi.fn();
  emitter.checkForUpdates = vi.fn();
  emitter.quitAndInstall = vi.fn();
  return emitter;
}

export function make(over: Record<string, unknown> = {}) {
  const squirrel = fakeSquirrel();
  const calls = { tell: vi.fn(), notify: vi.fn(), openExternal: vi.fn(), onBeforeInstall: vi.fn(), onChange: vi.fn() };
  const updater = createUpdater({
    currentVersion: "0.3.0",
    packaged: true,
    autoUpdater: squirrel,
    fetchJson: () => Promise.resolve(feed("0.4.0")),
    log: { ...console, warn: () => {} },
    ...calls,
    ...over,
  });
  return { updater, squirrel, ...calls };
}
