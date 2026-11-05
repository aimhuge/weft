import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED, LATEST, feedFor, feedFromLatestYml, fetchLatestYml, squirrelShaped, windowsUpdaterOptions } from "./updater-win.cjs";

// Windows' updater: electron-updater's NsisUpdater behind the four Squirrel calls updater.cjs makes,
// fed by latest.yml. A fake NsisUpdater stands in; nothing downloads.

const LATEST_YML = `version: 0.7.6
files:
  - url: Weft-Setup-0.7.6-x64.exe
    sha512: abc
    size: 123
path: Weft-Setup-0.7.6-x64.exe
sha512: abc
releaseDate: '2026-11-05T10:00:00.000Z'
`;

class FakeNsis extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  disableDifferentialDownload = false;
  setFeedURL = vi.fn();
  checkForUpdates = vi.fn(() => Promise.resolve(null));
  quitAndInstall = vi.fn();
}

afterEach(() => vi.unstubAllGlobals());

describe("feedFromLatestYml", () => {
  it("reads latest.yml's version into update.json's shape", () => {
    expect(feedFromLatestYml(LATEST_YML)).toEqual({
      currentRelease: "0.7.6",
      releases: [{ version: "0.7.6", updateTo: { version: "0.7.6" } }],
      page: "https://github.com/aimhuge/weft/releases/tag/v0.7.6",
    });
    expect(feedFromLatestYml("version: '1.0.0-beta.1'\n").currentRelease).toBe("1.0.0-beta.1");
  });

  it("is empty when there's no version line", () => {
    expect(feedFromLatestYml("files: []\n")).toEqual({});
    expect(feedFromLatestYml(undefined)).toEqual({});
  });
});

describe("fetchLatestYml", () => {
  it("fetches the feed fresh and parses it", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(LATEST_YML) }));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchLatestYml(FEED)).currentRelease).toBe("0.7.6");
    expect(fetch).toHaveBeenCalledWith(FEED, { cache: "no-store" });
  });

  it("throws on an HTTP error (no installer in the latest release yet)", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404 }));
    await expect(fetchLatestYml(FEED)).rejects.toThrow("update feed: HTTP 404");
  });
});

describe("feedFor", () => {
  it("is latest.yml on x64 and latest-arm64.yml on arm64", () => {
    expect(feedFor("x64")).toBe(`${LATEST}/latest.yml`);
    expect(feedFor("arm64")).toBe(`${LATEST}/latest-arm64.yml`);
  });
});

describe("squirrelShaped", () => {
  it("sets up a quiet full download from the feed's folder", () => {
    const nsis = new FakeNsis();
    squirrelShaped(nsis, "https://example.com/releases/latest/download/latest.yml");
    expect(nsis.autoDownload).toBe(true);
    expect(nsis.autoInstallOnAppQuit).toBe(true);
    expect(nsis.disableDifferentialDownload).toBe(true);
    expect(nsis.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: "https://example.com/releases/latest/download", channel: "latest" });
    const arm = new FakeNsis();
    squirrelShaped(arm, feedFor("arm64"));
    expect(arm.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: LATEST, channel: "latest-arm64" });
    squirrelShaped(new FakeNsis()); // the default feed
    expect(FEED).toBe(feedFor(process.arch));
  });

  it("passes events through, and turns 'nothing to download' into an error", () => {
    const nsis = new FakeNsis();
    const updater = squirrelShaped(nsis);
    const downloaded = vi.fn();
    const error = vi.fn();
    expect(updater.on("update-downloaded", downloaded)).toBe(updater);
    updater.on("error", error);
    nsis.emit("update-downloaded");
    expect(downloaded).toHaveBeenCalled();
    nsis.emit("error", new Error("boom"));
    nsis.emit("update-not-available");
    expect(error.mock.calls.map(([e]) => (e as Error).message)).toEqual(["boom", "latest.yml offers no newer installer"]);
  });

  it("ignores before-quit-for-update, which updater.cjs handles itself", () => {
    const nsis = new FakeNsis();
    const updater = squirrelShaped(nsis);
    expect(updater.on("before-quit-for-update", vi.fn())).toBe(updater);
    expect(nsis.listenerCount("before-quit-for-update")).toBe(0);
    updater.setFeedURL();
    expect(nsis.setFeedURL).toHaveBeenCalledTimes(1);
  });

  it("checks without an unhandled rejection, and installs silently then relaunches", async () => {
    const nsis = new FakeNsis();
    nsis.checkForUpdates.mockReturnValueOnce(Promise.reject(new Error("offline")));
    const updater = squirrelShaped(nsis);
    updater.checkForUpdates();
    await Promise.resolve();
    expect(nsis.checkForUpdates).toHaveBeenCalled();
    nsis.checkForUpdates.mockReturnValueOnce(undefined as never);
    expect(() => updater.checkForUpdates()).not.toThrow();
    updater.quitAndInstall();
    expect(nsis.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
});

describe("windowsUpdaterOptions", () => {
  it("is nothing off Windows, so macOS keeps Squirrel", () => {
    const load = vi.fn();
    expect(windowsUpdaterOptions({ platform: "darwin", load })).toEqual({});
    expect(load).not.toHaveBeenCalled();
    if (process.platform !== "win32") expect(windowsUpdaterOptions()).toEqual({});
  });

  it("is electron-updater, latest.yml and its reader on Windows", () => {
    const nsis = new FakeNsis();
    const options = windowsUpdaterOptions({ platform: "win32", load: () => nsis as never });
    expect(options.feed).toBe(FEED);
    expect(options.fetchJson).toBe(fetchLatestYml);
    options.autoUpdater!.quitAndInstall();
    expect(nsis.quitAndInstall).toHaveBeenCalled();
  });

  it("loads electron-updater's autoUpdater by default", () => {
    // Primed in Node's require cache: the real one needs Electron's app to build its updater.
    const require = createRequire(import.meta.url);
    const file = require.resolve("electron-updater");
    const nsis = new FakeNsis();
    const saved = require.cache[file];
    require.cache[file] = { exports: { autoUpdater: nsis } } as NodeJS.Module;
    try {
      windowsUpdaterOptions({ platform: "win32" }).autoUpdater!.quitAndInstall();
      expect(nsis.quitAndInstall).toHaveBeenCalledWith(true, true);
    } finally {
      if (saved) require.cache[file] = saved;
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- unpriming the one entry this test primed
      else delete require.cache[file];
    }
  });
});
