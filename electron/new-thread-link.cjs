// weft://new?prompt=…&folder=…&title=…&cli=puku  opens the New Thread dialog with a pre-filled
// prompt. L-3: the dialog is pre-filled but the user has to click Start, so a clickjacked link
// can't fire a thread. start=1 is ignored on purpose.
const electron = require("electron");
const os = require("node:os");
const { READ_HEADERS } = require("./server-read.cjs");

// folder= is taken from the link as is (pentest 2026-10-18, F-5). A clickjacked or hostile link can
// make a card whose folder is, say, ~/.ssh, with a prompt of its choosing. What stops it is L-3 alone:
// the card is made unstarted and nothing runs until the user reads it and clicks Start. Don't count on
// the folder gate (lib/folder-guard.ts) here: it asks before a thread reaches outside the card's own
// folder, and this link picks that folder, so files inside it read with no question. The secret guard
// (lib/secret-guard.ts) still refuses .env files and the vault wherever the card runs. Narrowing
// folder= to the user's known projects (settings.projects) is the follow-up if the Start click ever
// stops being the gate.
async function resolveFolder(url, server) {
  const explicit = url.searchParams.get("folder");
  if (explicit) return explicit;
  const settings = await (await fetch(`${server.url}/api/settings`, READ_HEADERS)).json();
  return settings.projects?.[0]?.path ?? os.homedir();
}

function createNewThreadLink({ getServer, getWin, sendMenu, dialog = electron.dialog }) {
  return async function handleNewThreadLink(url) {
    const prompt = url.searchParams.get("prompt");
    if (!prompt) return sendMenu("new-thread");
    try {
      const folder = await resolveFolder(url, getServer());
      const res = await fetch(`${getServer().url}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-weft-token": "1" },
        body: JSON.stringify({
          prompt,
          title: url.searchParams.get("title") ?? undefined,
          cwd: folder,
          backend: url.searchParams.get("cli") === "puku" ? "puku" : "claude",
          start: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      sendMenu("open-card", data.card.id);
    } catch (err) {
      dialog.showMessageBox(getWin(), { type: "warning", message: "Couldn't create the card", detail: err.message });
    }
  };
}

module.exports = { createNewThreadLink, resolveFolder };
