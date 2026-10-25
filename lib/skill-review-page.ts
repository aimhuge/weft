import type { ScanFinding, SkillReview, SkillScan } from "./types";

// The page a skill review opens in the browser pane (lib/skill-review.ts): the static scan at once, and the
// AI review under it when it lands. Everything on it comes from an untrusted skill, so every string is escaped
// and a CSP turns off script entirely; the pane gives file: pages its bridge (electron/pane-preload.cjs), and a
// review page must never be able to reach it. While the review runs, a meta refresh reloads it.

export interface ReviewPageInput {
  name: string;
  source: string;
  scan: SkillScan;
  review?: SkillReview;
  running?: boolean;
  error?: string;
}

export const esc = (s: string | number | undefined) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const STATIC_LABEL = { danger: "Danger", warn: "Worth a look", clean: "Clean" } as const;
const AI_LABEL = { unsafe: "Unsafe", caution: "Use with care", safe: "Looks safe" } as const;
const TONE = { danger: "bad", unsafe: "bad", high: "bad", warn: "warn", caution: "warn", medium: "warn", clean: "ok", safe: "ok", low: "dim", info: "dim" } as const;

const pill = (tone: string, text: string) => `<span class="pill ${tone}">${esc(text)}</span>`;
const where = (file?: string, line?: number) => (file ? `<code>${esc(file)}${line ? `:${line}` : ""}</code>` : "");

function findingRow(f: ScanFinding, review?: SkillReview): string {
  const fp = review?.falsePositives.find((p) => p.rule === f.rule && (!p.file || p.file === f.file));
  return `<li class="${fp ? "fp" : ""}">${pill(TONE[f.severity], f.severity)} <b>${esc(f.message)}</b> ${where(f.file, f.line)}${f.excerpt ? `<pre>${esc(f.excerpt)}</pre>` : ""}${fp ? `<p class="why">✓ AI: harmless. ${esc(fp.why)}</p>` : ""}</li>`;
}

function aiSection(input: ReviewPageInput): string {
  const { review, running, error } = input;
  if (running) return `<section class="card"><h2>AI review</h2><p class="muted"><span class="spin"></span> Sonnet is reading the skill. This page updates by itself when it's done (usually under a minute).</p></section>`;
  if (error) return `<section class="card"><h2>AI review</h2><p class="bad-text">The review didn't finish: ${esc(error)}</p></section>`;
  if (!review) return "";
  const concerns = review.concerns.length
    ? `<ul>${review.concerns.map((c) => `<li>${pill(TONE[c.severity], c.severity)} ${esc(c.explanation)} ${where(c.file, c.line)}</li>`).join("")}</ul>`
    : `<p class="muted">No concerns.</p>`;
  return `<section class="card"><h2>AI review ${pill(TONE[review.verdict], AI_LABEL[review.verdict])}</h2>
<p class="lead">${esc(review.summary)}</p>
<h3>What it does</h3><p>${esc(review.whatItDoes)}</p>
<h3>Concerns</h3>${concerns}
<h3>Data leaving your machine</h3><p>${esc(review.dataFlow)}</p>
<h3>License</h3><p>${esc(review.license)}</p>
<h3>Recommendation</h3><p class="lead">${esc(review.recommendation)}</p>
<p class="muted small">Reviewed by ${esc(review.model)} on ${esc(new Date(review.reviewedAt).toLocaleDateString("en", { dateStyle: "medium" }))}. Kept with this exact copy of the skill, so it isn't run again.</p></section>`;
}

export function renderReviewPage(input: ReviewPageInput): string {
  const { name, source, scan, review, running } = input;
  const real = scan.findings.filter((f) => f.severity !== "info" || f.rule === "hosts");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
${running ? '<meta http-equiv="refresh" content="3">' : ""}
<title>Skill review · ${esc(name)}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--card:#fff;--line:#e6e2da;--ink:#1d1b18;--muted:#6f6a61;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--card:#1a1c21;--line:#2a2d35;--ink:#ecebe8;--muted:#9a9890;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171}}
body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,system-ui,sans-serif;max-width:860px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:0 0 10px;display:flex;gap:8px;align-items:center}h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 4px}
.src{color:var(--muted);margin:2px 0 14px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 14px}
.pill{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid currentColor;vertical-align:middle}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.dim{color:var(--muted)}.bad-text{color:var(--bad)}
ul{margin:0;padding-left:0;list-style:none}li{padding:8px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
li.fp{opacity:.65}pre{margin:6px 0 0;padding:6px 8px;background:var(--bg);border:1px solid var(--line);border-radius:6px;white-space:pre-wrap;word-break:break-all;font-size:12px}
code{font-size:12px;color:var(--muted)}.why{margin:4px 0 0;color:var(--ok);font-size:12.5px}.lead{font-size:15px}.muted{color:var(--muted)}.small{font-size:12px}
.stats{display:flex;gap:18px;color:var(--muted);font-size:12.5px;margin-top:8px}
.spin{display:inline-block;width:10px;height:10px;border:2px solid var(--line);border-top-color:var(--ink);border-radius:50%;animation:s 1s linear infinite;vertical-align:-1px}@keyframes s{to{transform:rotate(360deg)}}
</style></head><body>
<h1>✦ ${esc(name)}</h1><p class="src">${esc(source)}</p>
<section class="card"><h2>Static scan ${pill(TONE[scan.verdict], STATIC_LABEL[scan.verdict])}${review ? ` AI ${pill(TONE[review.verdict], AI_LABEL[review.verdict])}` : ""}</h2>
<div class="stats"><span>${scan.files} files</span><span>${Math.round(scan.bytes / 1024)} KB</span><span>License: ${esc(scan.license.spdx ?? scan.license.kind)}</span><span>${scan.hosts.length} hosts called</span></div>
${real.length ? `<h3>Findings</h3><ul>${real.map((f) => findingRow(f, review)).join("")}</ul>` : `<p class="muted">The rules found nothing.</p>`}
</section>
${aiSection(input)}
</body></html>`;
}
