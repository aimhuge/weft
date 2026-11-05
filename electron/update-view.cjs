// What the Software Update window (update-window.cjs) says for an updater state: a headline, a line under
// it, the release notes and the buttons. Pure, so the window's page only draws what this returns.
const CHECK_HOURS = 4;

function ago(at, now) {
  const mins = Math.round((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

// A failed check in plain words: a 404 on the feed means no release carries update.json yet.
function errorDetail(error) {
  if (/HTTP 404/.test(error)) return "No Weft release is published on GitHub yet, so there's nothing to download.";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(error)) return "GitHub couldn't be reached. Check the connection and try again.";
  return error;
}

function headline(state, currentVersion, packaged) {
  const v = state.version;
  switch (state.phase) {
    case "checking":
      return { tone: "busy", title: "Checking for updates…", detail: "Asking GitHub Releases for the newest Weft." };
    case "downloading":
      return { tone: "busy", title: `Downloading Weft ${v}…`, detail: "It downloads in the background. You can close this window." };
    case "ready":
      return { tone: "new", title: `Weft ${v} is ready`, detail: "Weft restarts into it on its own once no threads are running and you've been away for 10 minutes. Or restart now: with threads running, Weft asks whether to wait for them." };
    case "available":
      return {
        tone: "new",
        title: `Weft ${v} is out`,
        detail: packaged
          ? "This build can't update itself, so get the new version from its release page."
          : "Dev mode updates with git pull. The release page has the app build.",
      };
  }
  if (state.error) return { tone: "error", title: "Couldn't check for updates", detail: errorDetail(state.error) };
  if (state.upToDate) return { tone: "ok", title: "You're up to date", detail: `Weft ${currentVersion} is the newest version.` };
  return {
    tone: "idle",
    title: `Weft ${currentVersion}`,
    detail: packaged
      ? `Weft checks for updates at launch and every ${CHECK_HOURS} hours.`
      : "Dev mode doesn't check on its own: git pull updates it. Check Now asks GitHub anyway.",
  };
}

function buttons(state) {
  const check = (label = "Check Now") => ({ action: "check", label });
  switch (state.phase) {
    case "checking":
      return [{ ...check(), disabled: true }];
    case "downloading":
      return [{ action: "close", label: "Close" }];
    case "ready":
      return [
        { action: "close", label: "Later" },
        { action: "install", label: "Restart to Update", primary: true },
      ];
    case "available":
      return [check("Check Again"), { action: "download", label: "Download…", primary: true }];
  }
  if (state.error) return [{ action: "releases", label: "Releases on GitHub" }, { ...check("Try Again"), primary: true }];
  return [{ ...check(), primary: true }];
}

// `running` is the version with its server patch, when one runs ("0.6.7+abc123", server-patch.cjs).
function updateView({ state, currentVersion, packaged, running = null }, now = Date.now()) {
  return {
    ...headline(state, currentVersion, packaged),
    current: `Weft ${running || currentVersion}${packaged ? "" : " (dev)"}`,
    latest: state.version ? `Weft ${state.version}` : "",
    notes: state.notes || "",
    checked: state.checkedAt ? `Checked ${ago(state.checkedAt, now)}` : "Not checked yet",
    buttons: buttons(state),
  };
}

module.exports = { updateView, errorDetail, ago };
