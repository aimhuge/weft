// Windows updates: electron-updater's NSIS updater, dressed as Electron's own autoUpdater (Squirrel.Mac),
// so electron/updater.cjs runs one flow on both: check, download in the background, "Restart to Update",
// install when nobody's there. docs/architecture/windows.md.
//
// The feed is latest.yml (latest-arm64.yml on arm64), which electron-builder writes beside Weft-Setup-X-<arch>.exe
// and the release's Windows jobs upload. Reading it (not update.json) means a Windows Weft sees a release only once its installer is up: the
// Mac dmg is published first and the Windows build lands minutes later.
//
// The installer is unsigned: electron-updater checks an update's signature only against a publisherName, and
// Weft sets none, so updates install without SmartScreen's prompt (that shows once, on the first install).
const LATEST = "https://github.com/aimhuge/weft/releases/latest/download";
// Each arch has its own installer and feed: latest.yml (x64) and latest-arm64.yml (built on an arm64 runner).
const feedFor = (arch) => `${LATEST}/${arch === "arm64" ? "latest-arm64" : "latest"}.yml`;
const FEED = process.env.WEFT_UPDATE_FEED || feedFor(process.arch);
const RELEASES = "https://github.com/aimhuge/weft/releases";

// latest.yml as the update.json shape updater.cjs reads ({ currentRelease, page }); {} when it names no version.
function feedFromLatestYml(text) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(String(text))?.[1];
  if (!version) return {};
  return { currentRelease: version, releases: [{ version, updateTo: { version } }], page: `${RELEASES}/tag/v${version}` };
}

async function fetchLatestYml(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`update feed: HTTP ${res.status}`);
  return feedFromLatestYml(await res.text());
}

// The folder the installer and latest.yml sit in, and the feed's name without .yml (electron-updater's channel), from its url.
const baseOf = (feed) => feed.replace(/\/[^/]*$/, "");
const channelOf = (feed) => feed.replace(/^.*\//, "").replace(/\.yml$/, "");

// electron-updater's NsisUpdater with the four calls updater.cjs makes of Squirrel.
function squirrelShaped(nsis, feed = FEED) {
  nsis.autoDownload = true;
  nsis.autoInstallOnAppQuit = true;
  // Differential downloads need the old version's blockmap beside the new one; latest/download has only the new.
  nsis.disableDifferentialDownload = true;
  // The channel in the feed's config, not nsis.channel: setting that also allows downgrades.
  nsis.setFeedURL({ provider: "generic", url: baseOf(feed), channel: channelOf(feed) });
  return {
    on(event, listener) {
      // electron-updater emits this on Electron's own autoUpdater; updater.cjs calls onBeforeInstall itself.
      if (event === "before-quit-for-update") return this;
      nsis.on(event, listener);
      // A check that finds nothing to download would leave updater.cjs "downloading" forever: say so as an error,
      // which falls back to the release page.
      if (event === "error") nsis.on("update-not-available", () => listener(new Error("latest.yml offers no newer installer")));
      return this;
    },
    setFeedURL() {},
    checkForUpdates() {
      nsis.checkForUpdates()?.catch?.(() => {}); // failures arrive as "error" events too
    },
    // Silent install (/S), then start the new Weft.
    quitAndInstall() {
      nsis.quitAndInstall(true, true);
    },
  };
}

// What createUpdater needs on Windows, or {} anywhere else (macOS keeps Squirrel).
function windowsUpdaterOptions({ platform = process.platform, load = () => require("electron-updater").autoUpdater } = {}) {
  if (platform !== "win32") return {};
  return { autoUpdater: squirrelShaped(load()), feed: FEED, fetchJson: fetchLatestYml };
}

module.exports = { feedFromLatestYml, feedFor, fetchLatestYml, squirrelShaped, windowsUpdaterOptions, FEED, LATEST };
