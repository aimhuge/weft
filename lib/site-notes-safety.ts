import { HIDDEN_CHARS, RULES } from "./skill-scan-rules";

// The safety pass every site note goes through before it is written, uploaded or served
// (docs/architecture/site-notes.md#safety). A note is data another user's card reads, so it may suggest paths,
// labels and selectors on its own site and nothing else. Lines that try to reach secrets, other hosts or a shell
// are stripped; a note that tries to steer the model itself (an override, a fake closing tag, hidden characters)
// is rejected whole. Built on the skill scan's rules (lib/skill-scan-rules.ts). Pure.

export type NoteFinding = { rule: string; message: string; line?: number; excerpt?: string };
export type SafeNote = { body: string; findings: NoteFinding[]; rejected: boolean };

export const MAX_NOTE_CHARS = 6000;
// Less than this left once lines are stripped: there's nothing worth serving.
const MIN_USEFUL_CHARS = 40;

// Whole-note rejections: the note is aimed at the model, not at the site.
const PROMPT_RULES = RULES.filter((r) => r.category === "prompt" && r.severity === "danger");
const STEERING = /<\/?\s*(site-note|system|instructions?|assistant|user|human|tool_result|function_calls?)\b[^>]*>|^\s*(system|assistant|human|user)\s*:/im;
const OBEY = /\b(you|the (agent|assistant|model|card)) (must|should|are required to|have to) (now |always |first )?(ignore|obey|follow these|trust this|stop|tell|send|email|post|upload|share|install|download|run|execute)\b/i;

// Line strips, each with what it guards against.
const LINE_RULES: Array<{ rule: string; message: string; pattern: RegExp }> = [
  {
    rule: "secret-tools",
    message: "Mentions Weft's vault tools",
    pattern: /\bmcp__secrets\b|\bfill_field\b|\bsecrets?__\w+|\btouch ?id\b|🔐/i,
  },
  {
    rule: "secret-handling",
    message: "Tells the card to fill, reveal or move a secret",
    pattern:
      /\b(fill|paste|enter|type(?!\s*=)|reveal|unhide|unmask|show|copy|send|share|print|read out|exfiltrate|post|upload|email|log|echo|write down|store)\b[^.\n]{0,50}\b(secret|api[ _-]?key|keys?|token|password|passphrase|credential|service[ _-]?role|private key|client secret|mnemonic|seed phrase)s?\b/i,
  },
  {
    rule: "other-tools",
    message: "Names a tool other than the browser pane's",
    pattern: /\bmcp__(?!browser__)\w+|\bBash\b|\bterminal\b|\bshell\b|\bcommand line\b/i,
  },
  {
    rule: "command",
    message: "Holds a command to run",
    pattern: /(^|\s)\$\s+\w|\b(curl|wget|npm|pnpm|npx|yarn|pip|brew|git|sudo|chmod|bash|zsh|powershell|osascript)\s+[-\w]|\brm\s+-|\beval\s*\(|javascript:|\bdocument\.cookie\b|\blocalStorage\b|\bfetch\s*\(/i,
  },
];

const CODE_FENCE = /^(\s*)(```|~~~)\s*([\w+-]*)/;
const RUNNABLE_LANG = /^(bash|sh|zsh|shell|console|terminal|powershell|ps1|cmd|bat|js|javascript|ts|typescript|python|py|ruby|rb|applescript|sql)$/i;
const DANGER_CODE = RULES.filter((r) => r.category === "code" && r.severity === "danger");

const URL_HOST = /\bhttps?:\/\/([a-z0-9.-]+)/gi;
const BARE_DOMAIN = /(?<![\w@/.-])((?:[a-z0-9-]+\.)+(?:com|io|dev|app|net|org|co|ai|zip|sh|xyz|me|cloud|so|gg|tv|ru|cn|tk|top|link|site|online))\b(?![\w-])/gi;

// The note's host, its subdomains and its parent domain are the same site: supabase.com may send you to
// app.supabase.com, and dashboard.stripe.com to stripe.com.
export function sameSite(host: string, other: string): boolean {
  const a = host.toLowerCase().replace(/^www\./, "");
  const b = other.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  // The registrable domain: two labels, or three under a country's second level (`foo.co.uk`, `bar.com.au`).
  const root = (h: string) => {
    const labels = h.split(".");
    const keep = labels.length > 2 && /^[a-z]{2}$/.test(String(labels[labels.length - 1])) && /^(co|com|org|net|gov|ac|edu|ne|or)$/.test(String(labels[labels.length - 2])) ? 3 : 2;
    return labels.slice(-keep).join(".");
  };
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`) || root(a) === root(b);
}

function foreignHost(line: string, host: string): string | undefined {
  for (const m of line.matchAll(URL_HOST)) if (!sameSite(host, String(m[1]))) return m[1];
  for (const m of line.matchAll(BARE_DOMAIN)) if (!sameSite(host, String(m[1]))) return m[1];
  return undefined;
}

const excerpt = (line: string) => (line.trim().length > 120 ? `${line.trim().slice(0, 119)}…` : line.trim());

function lineFinding(line: string, host: string): Omit<NoteFinding, "line" | "excerpt"> | undefined {
  // The skill scan's specific code rules first, so a finding names what it is (pipe-to-shell, not just "command").
  for (const r of DANGER_CODE) if (r.pattern.test(line)) return { rule: r.id, message: r.message };
  for (const r of LINE_RULES) if (r.pattern.test(line)) return { rule: r.rule, message: r.message };
  const other = foreignHost(line, host);
  if (other) return { rule: "other-host", message: `Points at another site (${other})` };
  return undefined;
}

function rejectFinding(body: string): NoteFinding | undefined {
  const hidden = HIDDEN_CHARS.exec(body.replace(/^﻿/, ""));
  if (hidden) return { rule: "hidden-chars", message: "Holds invisible characters a model reads but you can't see" };
  for (const r of PROMPT_RULES) if (r.pattern.test(body)) return { rule: r.id, message: r.message };
  if (STEERING.test(body)) return { rule: "fake-turn", message: "Pretends to be a tag, a turn or a system message" };
  if (OBEY.test(body)) return { rule: "orders", message: "Gives the card orders instead of describing the site" };
  return undefined;
}

export function sanitizeNote(raw: string, host: string): SafeNote {
  const body = raw.replace(/\r\n?/g, "\n");
  const reject = rejectFinding(body);
  if (reject) return { body: "", findings: [reject], rejected: true };

  const findings: NoteFinding[] = [];
  const kept: string[] = [];
  let fence: { runnable: boolean; start: number } | null = null;
  body.split("\n").forEach((line, i) => {
    const open = CODE_FENCE.exec(line);
    if (open && !fence) {
      fence = { runnable: RUNNABLE_LANG.test(String(open[3])), start: i + 1 };
      if (fence.runnable) findings.push({ rule: "code-block", message: "A block of code to run", line: i + 1, excerpt: excerpt(line) });
      else kept.push(line);
      return;
    }
    if (open && fence) {
      const wasRunnable = fence.runnable;
      fence = null;
      if (!wasRunnable) kept.push(line);
      return;
    }
    if (fence?.runnable) return;
    const hit = lineFinding(line, host);
    if (hit) findings.push({ ...hit, line: i + 1, excerpt: excerpt(line) });
    else kept.push(line);
  });

  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > MAX_NOTE_CHARS) {
    out = out.slice(0, MAX_NOTE_CHARS).replace(/\n[^\n]*$/, "");
    findings.push({ rule: "too-long", message: `Cut to ${MAX_NOTE_CHARS} characters` });
  }
  const useful = out.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
  if (useful.length < MIN_USEFUL_CHARS) return { body: "", findings: [...findings, { rule: "empty", message: "Nothing useful left" }], rejected: true };
  return { body: out, findings, rejected: false };
}
