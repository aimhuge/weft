import { SETTINGS_PAGES, type SettingsPage } from "./settings-nav";

// Every section on every Settings page, in the order it draws: what the search box finds and what each page's
// top nav jumps between. `title` is the section's heading text exactly as it renders (an h3, or Sync's h4), so the
// dialog can find it on the page; `words` are what people might type instead. A section that isn't drawn right now
// (signed out, nothing set up yet) simply has no chip, and a search for it still opens its page. `hint` is the one line
// the search list shows under the title, so you know what a hit is before you open it; it's searched too.
export type SettingsSection = { page: SettingsPage; title: string; words: string; hint: string };

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { page: "general", title: "Appearance", words: "theme dark mode light mode scene wallpaper colors palette", hint: "Light, dark or system, and the scene behind the board." },
  { page: "general", title: "Interface language", words: "locale English Chinese translation", hint: "English or Simplified Chinese for the board and Settings." },
  { page: "general", title: "Advanced mode", words: "regular mode simple basic chrome minimal clean", hint: "The full board: tool rail, badges, list view and card details." },
  { page: "general", title: "Show backlog", words: "column", hint: "A column for threads you add without starting them." },
  { page: "general", title: "Show progress", words: "streak level xp badges quiet mode", hint: "Your streak and level in the header, with badges as toasts." },
  { page: "general", title: "Count my Claude Code history", words: "xp sessions profile wefter", hint: "Let sessions from before Weft count toward XP and streaks." },
  { page: "general", title: "The welcome", words: "onboarding replay tips reset", hint: "Run the first-launch screens again, or reset the tips." },
  { page: "general", title: "Open cards that need you while I'm away", words: "away idle needs you auto open", hint: "Open a card that moves to Needs you while you're idle." },
  { page: "general", title: "Dictation", words: "mic microphone voice speech whisper language vocabulary transcribe", hint: "Speech to text on this Mac with whisper, in any app." },
  { page: "general", title: "Sounds", words: "chime audio mute", hint: "A short chime when a card changes column." },
  { page: "laptop", title: "Keep awake now", words: "sleep lid caffeinate", hint: "Keep this Mac awake right now, even with the lid shut." },
  { page: "laptop", title: "Always while threads run", words: "sleep awake auto", hint: "Stay awake on its own whenever a thread is running." },
  { page: "laptop", title: "Only while online", words: "network offline sleep", hint: "Let the Mac sleep when it loses the network." },
  { page: "laptop", title: "Sleep at low battery", words: "battery charge power", hint: "Let the Mac sleep once the battery runs low." },
  { page: "models", title: "New threads", words: "default model cli effort claude puku codex goose", hint: "The CLI, model and effort a new thread starts with." },
  { page: "models", title: "Use for subagents", words: "subagent model delegate", hint: "The model threads hand delegated work to." },
  { page: "models", title: "Copilot", words: "copilot model", hint: "The model the board's copilot runs on." },
  { page: "models", title: "Review all", words: "review model", hint: "The model that reviews every card in Review at once." },
  { page: "models", title: "Run /weft:done on", words: "done commit model effort", hint: "The model and effort that wrap up a card on Done." },
  { page: "models", title: "Backup model", words: "fallback failed rerun", hint: "The model a failed first message can rerun on." },
  { page: "models", title: "Bring your own key", words: "byok goose openrouter api key provider", hint: "Run Goose on your own provider and API key." },
  { page: "threads", title: "Threads running at once", words: "max limit slots concurrent parallel", hint: "How many threads may run at the same time." },
  { page: "threads", title: "Keep conversations open", words: "keep alive warm", hint: "A thread's CLI stays open between messages, so replies start fast." },
  { page: "threads", title: "Thread instructions", words: "system prompt board status", hint: "What every thread is told before your prompt." },
  { page: "agents", title: "Agents", words: "soul builder copywriter persona", hint: "Who your threads are: their soul, skills and name." },
  { page: "agents", title: "Each project's default", words: "project agent", hint: "The agent a new thread in each project starts as." },
  { page: "security", title: "Default permission mode", words: "permissions ask auto bypass plan", hint: "What threads may do without asking you first." },
  { page: "security", title: "Ask before deleting a card", words: "delete confirm", hint: "Confirm before a card and its thread are deleted." },
  { page: "security", title: "Trusted folders", words: "folders allow read outside", hint: "Folders outside a project that threads may read." },
  { page: "security", title: "Sign-in expiry", words: "token expire blastcp", hint: "How long each saved sign-in lasts, and which never run out." },
  { page: "secrets", title: "Vaults", words: "secrets vault share join devices recovery key import locate env files event log", hint: "Each project's vault: sharing, its Macs, the recovery key and env files." },
  { page: "secrets", title: "Keychain access", words: "keychain audit vault secrets log", hint: "A log of each Keychain read and vault use. Names only." },
  { page: "security", title: "Site notes", words: "dashboards pane notes", hint: "What cards learn about dashboards, so the next goes straight there." },
  { page: "security", title: "Setup stats", words: "analytics telemetry privacy", hint: "Which welcome steps people finish. Nothing from your board." },
  { page: "automations", title: "Skills and automations", words: "skill rules trigger", hint: "Skills that run on their own when a rule matches." },
  { page: "automations", title: "Push on Done", words: "git push branch", hint: "Push the branch to GitHub when a card moves to Done." },
  { page: "shortcuts", title: "Shortcuts", words: "keys keyboard hotkey", hint: "Keys for the board's global actions, and changing them." },
  { page: "accounts", title: "Weft account", words: "sign in login github", hint: "Sign in to Weft for teams, sync and weft.zip." },
  { page: "accounts", title: "CLIs", words: "claude code puku codex goose login", hint: "Sign Claude Code, puku, Codex and Goose in or out." },
  { page: "connectors", title: "Google Workspace", words: "gog gmail calendar drive docs sheets", hint: "Let threads use your Gmail, Calendar, Drive and Docs." },
  { page: "connectors", title: "📱 Simulators", words: "ios android emulator xcode simulator", hint: "Xcode, Android SDK and tools for driving simulators." },
  { page: "devices", title: "Your devices", words: "devices revoke worker phone browser mac keys passkey pair add a worker", hint: "Every Mac, worker, phone and browser holding your keys." },
  { page: "sync", title: "Status", words: "sync now upload", hint: "Whether sync is up to date, and Sync now." },
  { page: "sync", title: "Projects", words: "folders upload", hint: "Which projects upload their cards to your workspace." },
  { page: "sync", title: "Phones", words: "phone mobile push notifications", hint: "Phones that get your cards and push notifications." },
  { page: "sync", title: "Pair a phone", words: "pair seal encrypt approve web", hint: "Pair a phone or browser with a passkey and Touch ID." },
  { page: "sync", title: "Workers", words: "worker vps mac mini headless", hint: "Your Weft Workers: headless hosts that run cards." },
];

export const sectionsOf = (page: SettingsPage) => SETTINGS_SECTIONS.filter((s) => s.page === page);

// One search result: a section, or a whole page when the words match the page itself (Teams has no sections).
export type SettingsHit = { page: SettingsPage; title: string | null; pageLabel: string; hint: string };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}/:\s]/gu, " ").replace(/\s+/g, " ").trim();

// How well the text matches the query: every word of the query has to appear, and a word that starts the title
// or a word in it scores higher than one found only in the extra words.
function score(query: string[], title: string, extra: string): number {
  const t = norm(title);
  const tWords = t.split(" ");
  const all = `${t} ${norm(extra)}`;
  let total = 0;
  for (const q of query) {
    if (!all.includes(q)) return 0;
    if (t.startsWith(q)) total += 4;
    else if (tWords.some((w) => w.startsWith(q))) total += 3;
    else if (t.includes(q)) total += 2;
    else total += 1;
  }
  return total;
}

// The sections and pages that match, best first; a tie keeps the order Settings draws them in.
export function searchSettings(query: string, limit = 8, translate = (text: string) => text): SettingsHit[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const label = (page: SettingsPage) => SETTINGS_PAGES.find((p) => p.id === page)?.label ?? page;
  const scored: { hit: SettingsHit; score: number; order: number }[] = [];
  SETTINGS_PAGES.forEach((p, i) => {
    const s = score(words, p.label, p.hint) || score(words, translate(p.label), translate(p.hint));
    // A page ties below its own sections: a hit that lands on the setting beats one that only opens its page.
    if (s) scored.push({ hit: { page: p.id, title: null, pageLabel: p.label, hint: p.hint }, score: s, order: i * 100 + 99 });
  });
  SETTINGS_SECTIONS.forEach((sec, i) => {
    const pageIndex = SETTINGS_PAGES.findIndex((p) => p.id === sec.page);
    const s = score(words, sec.title, `${sec.words} ${sec.hint} ${label(sec.page)}`) ||
      score(words, translate(sec.title), `${translate(sec.words)} ${translate(label(sec.page))}`);
    if (s) scored.push({ hit: { page: sec.page, title: sec.title, pageLabel: label(sec.page), hint: sec.hint }, score: s, order: pageIndex * 100 + i + 1 });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.hit);
}
