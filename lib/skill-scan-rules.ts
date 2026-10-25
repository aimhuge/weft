import type { ScanCategory, ScanSeverity } from "./types";

// What Weft's skill scan looks for (lib/skill-scan.ts). A skill is instructions a model follows with your
// tools, plus scripts it runs, so a line in SKILL.md is as able to do harm as a line in a .sh: every rule
// runs over every text file. Patterns stay narrow on purpose; a skill that trips one gets a closer look,
// not a verdict from a regex alone.

export interface ScanRule {
  id: string;
  category: ScanCategory;
  severity: ScanSeverity;
  message: string;
  pattern: RegExp;
}

export const RULES: ScanRule[] = [
  // Malicious or risky code.
  { id: "pipe-to-shell", category: "code", severity: "danger", message: "Downloads a script and pipes it straight into a shell", pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i },
  {
    id: "decode-and-run",
    category: "code",
    severity: "danger",
    message: "Decodes hidden data and runs it",
    pattern: /base64\s+(-d|--decode|-D)\b[^\n]*\|\s*(ba|z)?sh\b|\beval\s*\(\s*(atob|Buffer\.from|unescape)\s*\(|\bexec\s*\(\s*(base64\.b64decode|codecs\.decode|zlib\.decompress|marshal\.loads)|\beval\s*\(\s*compile\s*\(/i,
  },
  { id: "reverse-shell", category: "code", severity: "danger", message: "Opens a reverse shell", pattern: /\/dev\/tcp\/[\w.]+\/\d+|\bnc(at)?\s+(-\w+\s+)*-e\s|\bsocat\b[^\n]*\bexec:|\bbash\s+-i\s+>&/i },
  { id: "crypto-miner", category: "code", severity: "danger", message: "Mentions a crypto miner", pattern: /\bxmrig\b|stratum\+tcp:\/\/|\bcryptonight\b|\bcoinhive\b/i },
  { id: "destructive", category: "code", severity: "danger", message: "Deletes or overwrites the disk or home folder", pattern: /\brm\s+-[rRf]{1,3}\s+(\/|~|\$HOME)(\/?\*?)?(\s|$|["'])|\bmkfs\.\w+|\bdd\s+if=[^\n]*\bof=\/dev\/(disk|sd|nvme)/ },
  {
    id: "env-exfil",
    category: "code",
    severity: "danger",
    message: "Sends environment variables over the network",
    pattern: /\b(printenv|env)\b\s*\|\s*(curl|nc|wget)\b|process\.env\b[^\n]{0,60}\b(fetch|axios|request|https?\.request)\s*\(|os\.environ\b[^\n]{0,60}\b(requests\.(post|get)|urllib)/,
  },
  {
    id: "credentials",
    category: "code",
    severity: "warn",
    message: "Reads SSH keys, cloud credentials or the keychain",
    pattern: /~\/\.ssh\/|\bid_(rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.netrc\b|\.pypirc\b|\.docker\/config\.json|\bsecurity\s+find-(generic|internet)-password|login\.keychain|\.config\/gh\/hosts\.yml/i,
  },
  { id: "persistence", category: "code", severity: "warn", message: "Edits shell startup files or schedules itself to run", pattern: />>?\s*["']?(~|\$HOME)\/\.(zshrc|bashrc|bash_profile|profile|zprofile)\b|\bcrontab\s+-|LaunchAgents\/|\blaunchctl\s+(load|bootstrap)\b|\bsystemctl\s+(--user\s+)?enable\b/ },
  { id: "skip-safety", category: "code", severity: "warn", message: "Turns off permission prompts or sandboxing", pattern: /--dangerously-skip-permissions|\bbypassPermissions\b|--no-sandbox\b|\bchmod\s+(-R\s+)?(777|\+s|u\+s)\b/ },
  { id: "sudo", category: "code", severity: "warn", message: "Runs commands as root", pattern: /(^|[\s;&|`(])sudo\s+\S/ },
  { id: "obfuscated", category: "code", severity: "warn", message: "Holds a long encoded blob that can't be read", pattern: /[A-Za-z0-9+/]{400,}={0,2}|(\\x[0-9a-fA-F]{2}){24,}|String\.fromCharCode\((\s*\d+\s*,){20,}/ },

  // Prompt injection: instructions aimed at the model rather than the task.
  {
    id: "prompt-override",
    category: "prompt",
    severity: "danger",
    message: "Tells the model to ignore its instructions",
    pattern: /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+|your\s+)?(previous|prior|above|earlier|system)\s+(instructions|prompts?|rules|messages)\b|\boverride\s+(the\s+)?system\s+prompt\b|\byou\s+are\s+no\s+longer\s+(claude|an?\s+assistant)\b/i,
  },
  {
    id: "hide-from-user",
    category: "prompt",
    severity: "warn",
    message: "Tells the model to keep something from you",
    pattern: /\b(do\s+not|don't|never)\s+(tell|inform|mention\s+(this\s+)?to|show|reveal\s+(this\s+)?to|alert)\s+(the\s+)?user\b|\bwithout\s+(asking|telling|notifying|informing)\s+the\s+user\b|\bsilently\s+(run|send|upload|install|execute|post)\b/i,
  },
  { id: "hidden-text", category: "prompt", severity: "warn", message: "Hides instructions in an HTML comment", pattern: /<!--(?:(?!-->)[\s\S]){0,400}?\b(assistant|claude|the model|ignore|execute|run this|you must)\b[\s\S]*?-->/i },

  // Telemetry and data leaving the machine.
  {
    id: "exfil-endpoint",
    category: "telemetry",
    severity: "danger",
    message: "Posts to a webhook or capture endpoint often used to steal data",
    pattern: /discord(app)?\.com\/api\/webhooks\/\d|hooks\.slack\.com\/services\/[A-Z0-9]{6,}|webhook\.site|requestbin\.|pipedream\.net|\bngrok(-free)?\.(io|app|dev)\b|burpcollaborator\.net|\binteract\.sh\b|\boast\.(fun|live|site|me|pro)\b|api\.telegram\.org\/bot|transfer\.sh\b/i,
  },
  {
    id: "analytics",
    category: "telemetry",
    severity: "warn",
    message: "Ships an analytics or error-reporting SDK",
    pattern: /\bposthog\b|api\.segment\.(io|com)|\banalytics\.track\(|\bmixpanel\b|\bamplitude\b|google-analytics\.com|googletagmanager\.com|\bgtag\(|\bsentry_sdk\b|@sentry\/|ingest\.sentry\.io|datadoghq\.com|\bdd-trace\b|plausible\.io|\bhotjar\b|\bfullstory\b|\blogrocket\b|\bbugsnag\b|\brollbar\b|\bnewrelic\b/i,
  },
  { id: "beacon", category: "telemetry", severity: "warn", message: "Reports usage back somewhere", pattern: /navigator\.sendBeacon|\bphone[- ]home\b|\bsend_telemetry\b|\btrack(Event|Usage)\s*\(/i },
];

// Zero-width, bidi and tag characters: text a person can't see but a model reads. A leading BOM is fine.
export const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u;

// Files a person can't review by reading.
export const BINARY_EXT = /\.(exe|dll|so|dylib|bin|jar|wasm|pyc|class|node|app|dmg|pkg|deb|rpm|msi)$/i;

// Tests and fixtures quote attacks in order to catch them, and the model never reads them as instructions,
// so prompt rules skip them (code rules don't: a script there can still be run).
export const TEST_PATH = /(^|\/)(tests?|__tests__|fixtures?|spec)\//i;

// Script files, whose URLs are calls the skill makes (a URL in a .md is usually just a link).
export const CODE_EXT = /\.(py|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|fish|rb|go|rs|php|pl|ps1|bat|cmd|lua|swift|kt|java)$/i;

// Hosts that don't count as a call out: local ones and documentation placeholders.
export const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|example\.(com|org|net)$|[\w.-]*\.example\.com$|[\w.-]*\.local$)/i;
