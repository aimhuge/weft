import type { IntroId } from "./feature-intros";

// The tips the New thread splash (lib/show.ts) rotates through while you write the prompt: one at a time under the
// title, a new one every few seconds. Nothing plays on its own beside the dialog (lib/use-new-thread-pane.ts), so a
// tip about a drawer carries its intro instead: ▶ Watch plays that video in the pane, when you ask.
export type Tip = { text: string; intro?: IntroId };

export const TIPS: readonly Tip[] = [
  { text: "New here? A one-minute video on starting a thread and giving it a plan.", intro: "newthread" },
  { text: "⌘↵ starts the thread and closes this dialog; ⌃↵ starts it and keeps the dialog open, emptied, for the next one." },
  { text: "⌘B here adds a new thread to the Backlog, instead of starting." },
  { text: "Paste or drop an image right into the prompt - multi-modal agents can read them and get to work." },
  { text: "Drag files onto an empty board and a New thread opens with them attached." },
  { text: "Double-click any empty part of the board to open New thread." },
  { text: "⌘K opens the command palette: search cards, prompts, projects and commands." },
  { text: "Press ? for a searchable list of keyboard shortcuts." },
  { text: "Right-click a card: every item has a shortcut key. D moves it to Done, 1 runs /weft:done." },
  { text: "Shift+A archives the card you're on and steps to the next; Z brings it back." },
  { text: "Switch threads from shared to isolated for larger cards that need their own worktree." },
  { text: "Click any file path in a thread, or ⌘P, to open it in the editor beside the thread." },
  { text: "Your keys stay in the 🔐 vault: giving AI secure access to your credentials and letting you share across workstations.", intro: "vault" },
  { text: "Crons run a thread on a schedule: weekly reporting, morning updates, or just a quick hourly email check.", intro: "crons" },
  { text: "Skills teach your AI new tricks; Weft scans each skill before you install it.", intro: "skills" },
  { text: "Turn GitHub issues into cards on the board with Weft's GitHub integration.", intro: "github" },
  { text: "Keep your team in the loop on Slack.", intro: "slack" },
  { text: "Services lists your dev servers, and what they cost to keep running.", intro: "services" },
  { text: "Webhooks reach your local dev server through Weft, no tunnel needed.", intro: "webhooks" },
  { text: "Deploy to Vercel and watch the logs without leaving the board.", intro: "vercel" },
  { text: "Supabase: migrations, auth, functions and health, from the left rail.", intro: "supabase" },
  { text: "Your Cloudflare Worker, deployed and watched.", intro: "cloudflare" },
  { text: "BlastCP puts your social posts on one queue or calendar.", intro: "blastcp" },
  { text: "Code quality gives your repo a score, but also helps you refactor and keep your code clean.", intro: "quality" },
  { text: "Leagues: compete with your fellow wefters.", intro: "leagues" },
];

// Each New thread starts the rotation one tip further on, from a random place, so the first tip you read changes.
let tipTurn = Math.floor(Math.random() * TIPS.length);
export function nextTipIndex(count = TIPS.length) {
  return count ? tipTurn++ % count : 0;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// The tip card under the splash's title: the tips as JSON for the page's own script, which shows one at a time
// from `start` and fades to the next every 8 s. ▶ Watch needs Weft's origin (the intro page is served there,
// and electron/self-url.cjs lets it into the pane); without one, tips show no link.
export function tipCard(tips: readonly Tip[], start: number, origin?: string) {
  const shown = tips.map(({ text, intro }) => ({ text, watch: intro && origin ? new URL(`/intros/${intro}.html?live=1`, origin).href : "" }));
  const first = shown[start % shown.length];
  if (!first) return "";
  const link = (watch: string) => (watch ? `<a class="watch" href="${escape(watch)}">▶ Watch</a>` : "");
  return `<div class="tip" id="tip"><span class="k">Tip</span><span id="tip-text">${escape(first.text)}</span>${link(first.watch)}</div>
<script id="tips" type="application/json">${JSON.stringify(shown).replace(/</g, "\\u003c")}</script>
<script>(()=>{const tips=JSON.parse(document.getElementById("tips").textContent),box=document.getElementById("tip");let i=${start % shown.length};
const esc=(s)=>s.replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
setInterval(()=>{box.classList.add("out");setTimeout(()=>{i=(i+1)%tips.length;const t=tips[i];
box.innerHTML='<span class="k">Tip</span><span id="tip-text">'+esc(t.text)+'</span>'+(t.watch?'<a class="watch" href="'+esc(t.watch)+'">▶ Watch</a>':"");
box.classList.remove("out")},400)},8000)})();</script>`;
}

// The card's look, added to the splash's own style sheet.
export const TIP_CSS = `.tip{margin-top:14px;max-width:360px;color:var(--ink);background:rgb(20 14 24/.5);backdrop-filter:blur(10px);border:.5px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13px;line-height:1.5;transition:opacity .4s,transform .4s;animation:rise .7s .3s cubic-bezier(.2,.8,.2,1) backwards}
.tip.out{opacity:0;transform:translateY(4px)}
.tip .k{display:block;margin-bottom:3px;color:var(--accent);font:600 10px/1.4 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase}
.tip .watch{display:inline-block;margin-left:8px;color:var(--accent2);text-decoration:none;font-weight:600;white-space:nowrap}
.tip .watch:hover{text-decoration:underline}`;
