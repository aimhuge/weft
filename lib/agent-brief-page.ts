import { briefProjectName, type AgentBrief } from "./agent-thread";

// The page the new agent-design thread opens on: the brief it is running on.
//
// It is the thread's default show file — the pane has something current the moment the thread
// starts, before the thread has said anything. It shows the brief, not the thread's own output:
// the project, the job, and the shape of what the thread is about to do.
//
// It is written from the brief, not by a model, so it is there the instant the thread starts.

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// What the thread will do, in order: the steps it takes, so the brief on the page reads as a plan.
const STEPS: { title: string; body: string }[] = [
  { title: "It asks", body: "One question at a time, and only the ones that change what it writes." },
  { title: "It writes the soul", body: "Standing instructions, not a description: what it reads first, what it makes, what it refuses." },
  { title: "You read it", body: "The soul, on the page, before it saves anything." },
  { title: "It saves the agent", body: "It lands in Settings → Agents, ready to pick as a card's agent." },
];

export function briefPage(brief: AgentBrief): string {
  const project = briefProjectName(brief.project);
  const job = brief.job.trim();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Design an agent for ${escape(project)}</title><style>
html,body{height:100%;margin:0}
body{--ink:#f4efe6;--muted:#d9d0c3;--faint:#a99f92;--line:rgb(255 250 240/.14);--accent:#d9774b;
background:#14101a;color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
body::before{content:"";position:absolute;inset:-4%;background:radial-gradient(ellipse 70% 60% at 50% 0%,rgb(217 119 75/.16),transparent 70%);animation:drift 24s ease-in-out infinite alternate}
body::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 90% 80% at 50% 50%,transparent 55%,rgb(0 0 0/.4))}
main{position:relative;z-index:1;padding:8vh 7% 6vh;max-width:620px;animation:rise .7s cubic-bezier(.2,.8,.2,1) both}
.k{font:500 10.5px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;color:var(--accent);text-transform:uppercase}
h1{margin:10px 0 0;font-size:27px;line-height:1.2;font-weight:700;letter-spacing:-.02em}
.ask{margin-top:16px;padding:12px 14px;border-left:2px solid rgb(217 119 75/.65);background:rgb(255 250 240/.035);border-radius:0 8px 8px 0;color:#e3d9cb;font-size:14.5px}
.ask b{color:var(--ink);font-weight:600}
.path{margin-top:6px;font:500 11px ui-monospace,"SF Mono",Menlo,monospace;color:var(--faint)}
h2{margin:30px 0 10px;font:500 10.5px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;color:var(--faint);text-transform:uppercase}
ol{list-style:none;margin:0;padding:0;display:grid;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
li{display:flex;gap:12px;align-items:baseline;padding:11px 13px;background:#181320}
li .n{font:600 11px ui-monospace,"SF Mono",Menlo,monospace;color:var(--accent);min-width:14px}
li .t{font-weight:600;color:var(--ink)}
li .b{color:var(--muted);font-size:12.5px;line-height:1.5}
.status{margin-top:22px;display:flex;align-items:center;gap:8px;color:var(--faint);font-size:12px}
.bar{width:130px;height:3px;border-radius:3px;background:var(--line);overflow:hidden;position:relative}
.bar::after{content:"";position:absolute;inset:0;width:45%;border-radius:3px;background:linear-gradient(90deg,transparent,var(--accent),#8f97d6);animation:weave 1.4s ease-in-out infinite}
@keyframes weave{from{transform:translateX(-100%)}to{transform:translateX(280%)}}
@keyframes drift{to{transform:translateX(3%) scale(1.05)}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important}}
</style></head><body><main>
<div class="k">New thread · designing an agent</div>
<h1>Design an agent for ${escape(project)}</h1>
<div class="ask">Help me design an agent for <b>${escape(project)}</b> that ${escape(job)}</div>
<div class="path">${escape(brief.project)}</div>
<h2>What happens next</h2>
<ol>
${STEPS.map((s, i) => `  <li><span class="n">${i + 1}</span><span><span class="t">${escape(s.title)}.</span> <span class="b">${escape(s.body)}</span></span></li>`).join("\n")}
</ol>
<div class="status"><span class="bar" aria-hidden="true"></span><span>The thread is asking.</span></div>
</main></body></html>`;
}
