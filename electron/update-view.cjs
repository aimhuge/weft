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

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Dev mode follows origin/main (dev-update.cjs): commits, a fast-forward and a restart, not release downloads.
function devHeadline(state, currentVersion) {
  const n = state.commits || 0;
  switch (state.phase) {
    case "checking":
      return { tone: "busy", title: "Checking for updates…", detail: "Fetching main from GitHub." };
    case "pulling":
      return { tone: "busy", title: `Updating to ${plural(n, "new commit")}…`, detail: "Fast-forwarding this checkout, and installing packages when the lockfile moved." };
    case "available":
      return { tone: "new", title: `${plural(n, "new commit")} on main`, detail: "Update Now fast-forwards this checkout. Your uncommitted work stays as it is." };
    case "ready":
      return {
        tone: "new",
        title: state.version ? `Weft ${state.version} is pulled` : "Restart to finish updating",
        detail: "Weft's app code changed, so it needs a restart. It waits for running threads to finish.",
      };
  }
  if (state.error) return { tone: "error", title: "Couldn't update", detail: errorDetail(state.error) };
  if (state.pulled) return { tone: "ok", title: `Updated: ${plural(state.pulled, "commit")}`, detail: "The board picks the changes up on its own; no restart needed." };
  if (state.upToDate) return { tone: "ok", title: "You're up to date", detail: `This checkout is on the newest main.` };
  return { tone: "idle", title: `Weft ${currentVersion}`, detail: "Dev mode follows main on GitHub, checking at launch and every 4 hours." };
}

function devButtons(state) {
  const check = (label = "Check Now") => ({ action: "check", label });
  switch (state.phase) {
    case "checking":
    case "pulling":
      return [{ ...check(), disabled: true }];
    case "available":
      return [check("Check Again"), { action: "pull", label: "Update Now", primary: true }];
    case "ready":
      return [
        { action: "close", label: "Later" },
        { action: "install", label: "Restart to Update", primary: true },
      ];
  }
  return [{ ...check(state.error ? "Try Again" : "Check Now"), primary: true }];
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
// `dev` is a checkout following main (dev-update.cjs).
function updateView({ state, currentVersion, packaged, running = null, dev = false }, now = Date.now()) {
  const latest = dev ? (state.target ? `main @ ${state.target}` : "") : state.version ? `Weft ${state.version}` : "";
  return {
    ...(dev ? devHeadline(state, currentVersion) : headline(state, currentVersion, packaged)),
    current: `Weft ${running || currentVersion}${packaged ? "" : " (dev)"}`,
    latest,
    notes: state.notes || "",
    checked: state.checkedAt ? `Checked ${ago(state.checkedAt, now)}` : "Not checked yet",
    buttons: dev ? devButtons(state) : buttons(state),
  };
}

module.exports = { updateView, errorDetail, ago };
