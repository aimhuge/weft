import { generalizePath } from "./site-notes-url";

// The scrub every site note passes before it leaves the Mac (docs/architecture/site-notes.md#scrubbing): concrete
// values become general ones, so a note says "open /dashboard/project/:ref/settings/api", never which project.
// It runs on what a card did, on Haiku's draft, and again on weft.zip before a write, so a note scrubbed by an
// older Weft is still scrubbed. Vault values never get here at all: fill_field is recorded by selector only.

// Known secret shapes, by prefix or form. Anything that matches is a token, whatever it was for.
const TOKEN_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWTs
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, // Stripe
  /\b(whsec|sbp|sb_secret|sb_publishable|sk-ant-[a-z0-9]*|sk-proj|sk|xai|gsk|re|ghs|ghr)[_-][A-Za-z0-9_-]{16,}/g,
  /\b(ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{16,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// A long run of letters and digits mixed: generated ids, keys and hashes. Words and selectors don't look like this.
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
const PHONE = /(?<![\w-])\+\d[\d ()-]{7,}\d(?![\w-])/g;

// A URL keeps its host and its general path; its query string and fragment (state, tokens, ids) are dropped.
export function scrubUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "<url>";
  }
  const host = url.hostname.toLowerCase();
  return `${url.protocol}//${host}${generalizePath(url.pathname, host.replace(/^www\./, ""))}`.replace(/\/$/, "");
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `known` is what Weft knows names this user: their email, GitHub login, name, workspace slugs and names, project
// folder names. Each is replaced wherever it appears, case-insensitively, before the generic patterns run.
export function scrubText(text: string, known: string[] = []): string {
  let out = text;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, "<token>");
  out = out.replace(URL_PATTERN, (u) => scrubUrl(u));
  const names = [...new Set(known.map((k) => k.trim()).filter((k) => k.length >= 3))].sort((a, b) => b.length - a.length);
  for (const name of names) out = out.replace(new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, "gi"), "<account>");
  return out
    .replace(EMAIL, "<email>")
    .replace(UUID, ":id")
    .replace(IPV4, "<ip>")
    .replace(LONG_HEX, ":id")
    .replace(LONG_TOKEN, "<token>")
    .replace(PHONE, "<phone>");
}
