import { SETTINGS_PAGES, type SettingsPage } from "./settings-nav";

// Every section on every Settings page, in the order it draws: what the search box finds and what each page's
// top nav jumps between. `title` is the section's heading text exactly as it renders (an h3, or Sync's h4), so the
// dialog can find it on the page; `words` are what people might type instead. A section that isn't drawn right now
// (signed out, nothing set up yet) simply has no chip, and a search for it still opens its page.
export type SettingsSection = { page: SettingsPage; title: string; words?: string };

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { page: "general", title: "Appearance", words: "theme dark mode light mode scene wallpaper colors palette" },
  { page: "general", title: "Advanced mode", words: "regular mode simple basic chrome minimal clean" },
  { page: "general", title: "Show backlog", words: "column" },
  { page: "general", title: "Show progress", words: "streak level xp badges quiet mode" },
  { page: "general", title: "Count my Claude Code history", words: "xp sessions profile wefter" },
  { page: "general", title: "The welcome", words: "onboarding replay tips reset" },
  { page: "general", title: "Open cards that need you while I'm away", words: "away idle needs you auto open" },
  { page: "general", title: "Dictation", words: "mic microphone voice speech whisper language vocabulary transcribe" },
  { page: "general", title: "Sounds", words: "chime audio mute" },
  { page: "laptop", title: "Keep awake now", words: "sleep lid caffeinate" },
  { page: "laptop", title: "Always while threads run", words: "sleep awake auto" },
  { page: "laptop", title: "Only while online", words: "network offline sleep" },
  { page: "laptop", title: "Sleep at low battery", words: "battery charge power" },
  { page: "models", title: "New threads", words: "default model cli effort claude puku codex goose" },
  { page: "models", title: "Use for subagents", words: "subagent model delegate" },
  { page: "models", title: "Copilot", words: "copilot model" },
  { page: "models", title: "Review all", words: "review model" },
  { page: "models", title: "Run /weft:done on", words: "done commit model effort" },
  { page: "models", title: "Backup model", words: "fallback failed rerun" },
  { page: "models", title: "Bring your own key", words: "byok goose openrouter api key provider" },
  { page: "threads", title: "Threads running at once", words: "max limit slots concurrent parallel" },
  { page: "threads", title: "Keep conversations open", words: "keep alive warm" },
  { page: "threads", title: "Thread instructions", words: "system prompt board status" },
  { page: "agents", title: "Agents", words: "soul builder copywriter persona" },
  { page: "agents", title: "Each project's default", words: "project agent" },
  { page: "security", title: "Default permission mode", words: "permissions ask auto bypass plan" },
  { page: "security", title: "Ask before deleting a card", words: "delete confirm" },
  { page: "security", title: "Trusted folders", words: "folders allow read outside" },
  { page: "security", title: "Sign-in expiry", words: "token expire blastcp" },
  { page: "security", title: "Keychain access", words: "keychain audit vault secrets log" },
  { page: "security", title: "Site notes", words: "dashboards pane notes" },
  { page: "security", title: "Setup stats", words: "analytics telemetry privacy" },
  { page: "automations", title: "Skills and automations", words: "skill rules trigger" },
  { page: "automations", title: "Push on Done", words: "git push branch" },
  { page: "shortcuts", title: "Shortcuts", words: "keys keyboard hotkey" },
  { page: "accounts", title: "Weft account", words: "sign in login github" },
  { page: "accounts", title: "CLIs", words: "claude code puku codex goose login" },
  { page: "connectors", title: "Google Workspace", words: "gog gmail calendar drive docs sheets" },
  { page: "connectors", title: "📱 Simulators", words: "ios android emulator xcode simulator" },
  { page: "sync", title: "Status", words: "sync now upload" },
  { page: "sync", title: "Projects", words: "folders upload" },
  { page: "sync", title: "Phones", words: "phone mobile push notifications" },
  { page: "sync", title: "Pair a phone", words: "pair seal encrypt approve web" },
  { page: "sync", title: "Workers", words: "worker vps mac mini headless" },
];

export const sectionsOf = (page: SettingsPage) => SETTINGS_SECTIONS.filter((s) => s.page === page);

// One search result: a section, or a whole page when the words match the page itself (Teams has no sections).
export type SettingsHit = { page: SettingsPage; title: string | null; pageLabel: string };

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
export function searchSettings(query: string, limit = 8): SettingsHit[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const label = (page: SettingsPage) => SETTINGS_PAGES.find((p) => p.id === page)?.label ?? page;
  const scored: { hit: SettingsHit; score: number; order: number }[] = [];
  SETTINGS_PAGES.forEach((p, i) => {
    const s = score(words, p.label, p.hint);
    // A page ties below its own sections: a hit that lands on the setting beats one that only opens its page.
    if (s) scored.push({ hit: { page: p.id, title: null, pageLabel: p.label }, score: s, order: i * 100 + 99 });
  });
  SETTINGS_SECTIONS.forEach((sec, i) => {
    const pageIndex = SETTINGS_PAGES.findIndex((p) => p.id === sec.page);
    const s = score(words, sec.title, `${sec.words ?? ""} ${label(sec.page)}`);
    if (s) scored.push({ hit: { page: sec.page, title: sec.title, pageLabel: label(sec.page) }, score: s, order: pageIndex * 100 + i + 1 });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.hit);
}
