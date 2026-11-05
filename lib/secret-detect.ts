// Text that looks like a secret: an API key, a token, a private key, a database URL with a
// password, or a .env line. A thread keeps everything you send in its transcripts for good, so the
// Composer asks before pasting one and flags one typed or dropped in (docs/architecture/secrets.md). The
// pre-commit hook's fallback scan (scripts/secret-scan.mjs) and the thread env strip (lib/env.ts) use it too. Known key shapes only, plus .env
// lines with a secret-sounding name, so ordinary text and code don't trip it.

export interface SecretMatch {
  // What it looks like, for the warning: "a Stripe secret key".
  kind: string;
  // The start and end of the value with the middle hidden: "sk_live_51Hx…hJkL".
  preview: string;
  // The text itself, so the Composer can take it out again.
  value: string;
}

const PATTERNS: [string, RegExp][] = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)?/],
  ["a Stripe secret key", /\b[sr]k_(live|test)_[0-9a-zA-Z]{16,}/],
  ["a Stripe webhook secret", /\bwhsec_[0-9a-zA-Z]{24,}/],
  ["a GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["a GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI API key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ["an AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a Resend API key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9_]{16,}/],
  ["a SendGrid API key", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ["a Datadog API key", /\bdd_api_[A-Za-z0-9]{32,}/],
  ["a Firebase token", /\bAAAA[A-Za-z0-9_-]{7,}:[A-Za-z0-9_-]{140,}/],
  ["a Telegram bot token", /\b\d{6,10}:AA[A-Za-z0-9_-]{32,}/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  // A 32-hex run on its own: an MD5-shaped API key. Bounded by lookarounds so it doesn't bite a
  // chunk out of a longer hex hash (a SHA-256 is 64, a git SHA is 40).
  ["a 32-character hex key", /(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/],
  // A JWT. The header is always eyJ (base64 of {"alg"), but the payload needn't be: a Supabase
  // service-role key's claims start with a role, so the old two-eyJ rule missed it.
  ["a token (JWT)", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a database URL with a password", /\b(postgres(ql)?|mysql|mongodb(\+srv)?|rediss?|amqps?):\/\/[^:\s/@]+:[^@\s]{4,}@/],
];

// NAME=value where the name sounds secret and the value isn't a placeholder or a reference.
const ENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*["']?([^\s"'$<>{}]{8,})/m;
const PLACEHOLDER = /^(x{3,}|\*{3,}|\.{3,}|your|change|example|placeholder|replace|todo|dummy|fake|test-?key|secret$|process\.env)/i;

function mask(value: string): string {
  return value.length <= 12 ? `${value.slice(0, 2)}…` : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function findSecret(text: string): SecretMatch | null {
  for (const [kind, pattern] of PATTERNS) {
    const hit = pattern.exec(text);
    if (hit) return { kind, preview: kind === "a private key" ? "-----BEGIN … PRIVATE KEY-----" : mask(hit[0]), value: hit[0] };
  }
  const [, name, value] = ENV_LINE.exec(text) ?? [];
  if (name && value && !PLACEHOLDER.test(value)) return { kind: `a secret (${name})`, preview: mask(value), value };
  return null;
}
