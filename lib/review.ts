// A thread that moves to Review can hand the user a tour of what it built, as a fenced block like
//   ```weft-review
//   {"url": "http://localhost:3000", "dev": "npm run dev", "steps": [{"title": "Sign-in", "look": "Wrong password shows an error", "path": "/login"}]}
//   ```
// The board reads it to open the browser pane and walk the user through the steps (see
// components/ReviewPanel.tsx), and strips it from what it shows, as with lib/status.ts.

import type { ReviewPlan, ReviewStep } from "./types";

// What the thread is told about the block; appended to its system prompt (see drive() in lib/runner.ts).
export const REVIEW_PROMPT = `When you finish work for the user to review (BOARD STATUS column=review), also end the reply with a review tour: a fenced block tagged weft-review holding JSON, placed before the BOARD STATUS line.
\`\`\`weft-review
{"url": "http://localhost:3000", "dev": "npm run dev", "steps": [{"title": "Short feature name", "look": "What to check, in one short sentence", "path": "/page"}]}
\`\`\`
- url: where the running app is, when the work is a web product (start the dev server first if it isn't running); leave it out otherwise.
- dev: the shell command that starts that app from the project folder (e.g. "npm run dev"). Weft uses it to start the server for the user and keep it running while they review. Run the /weft:preview skill first to check the app is up and renders.
- steps: one per feature or change you built, in the order to check them. "path" (or a full "url", or an absolute file path such as a PDF or HTML file) is the page for that step; a local page may carry a #anchor or ?query (e.g. "/Users/me/.weft/show/tour.html#login"), so several steps can point at sections of one page. Never point a step at source code: when a change has no page (a prompt, a refactor, config), render it as a readable HTML page and point the step there.
- Before you send the reply, open the first step's page in the browser pane (mcp__browser__open_url) so the pane already shows it the moment the tour opens. Do this for every tour, including steps that are a file path rather than a web page.
- The user steps through these in the browser pane and sends feedback on each one. Keep each "look" to one short, checkable sentence (under 20 words): the review panel is small. Background, caveats and how-to go on the step's page, not in "look".`;

const BLOCK = /```weft-review[^\S\n]*\n([\s\S]*?)\n?```[^\S\n]*\n?/g;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePlan(raw: string): ReviewPlan | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  const { url, dev, steps } = data as { url?: unknown; dev?: unknown; steps?: unknown };
  if (!Array.isArray(steps)) return undefined;
  const parsed: ReviewStep[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const title = str(s.title);
    if (!title) continue;
    parsed.push({ title, look: str(s.look), path: str(s.path) ?? str(s.url) });
  }
  return parsed.length ? { url: str(url), dev: str(dev), steps: parsed } : undefined;
}

// Returns the text without any weft-review blocks, and the last valid plan found.
export function extractReview(text: string): { text: string; review?: ReviewPlan } {
  let review: ReviewPlan | undefined;
  const stripped = text.replace(BLOCK, (_all, raw: string) => {
    review = parsePlan(raw) ?? review;
    return "";
  });
  if (stripped === text) return { text };
  return { text: stripped.replace(/\n{3,}/g, "\n\n").trimEnd(), review };
}

// A step often names its page only in its "look" text; take the first web address or media/file path there.
const MENTIONED = /https?:\/\/[^\s"'<>)]+|(?:^|[\s"'(])(\/[^\s"'()<>]+\.(?:pdf|html?|png|jpe?g|gif|svg|webp|mp4|mov))(?=[\s"')<>.,;:]|$)/i;

function mentionedPage(text?: string): string | undefined {
  const m = text?.match(MENTIONED);
  return m ? (m[1] ?? m[0]).replace(/[.,;:]+$/, "") : undefined;
}

// The address of a step's page: its own full URL, the uploaded copy of a host's file (a worker's card on this board,
// lib/review-blobs.ts), a file on this machine, or its path on the plan's base URL.
export function stepUrl(plan: ReviewPlan, step: ReviewStep): string | undefined {
  const target = step.path ?? mentionedPage(step.look);
  if (target && /^(https?:\/\/|blob:sha256:)/i.test(target)) return target;
  const local = target?.startsWith("/") ? localFileUrl(target) : undefined;
  if (local) return local;
  if (!plan.url) return undefined;
  if (!step.path) return plan.url;
  try {
    return new URL(step.path, plan.url).toString();
  } catch {
    return plan.url;
  }
}

const LOCAL_ROOT = /^\/(Users|home|private|tmp|var|Volumes|opt)\//;
const MEDIA = /\.(pdf|html?|png|jpe?g|gif|svg|webp|mp4|mov)$/i;

// A path under a filesystem root (/Users/me/repo/SOUL.md) is a file of any type, never an app route;
// elsewhere only media and pages count as files.
function isFile(p: string): boolean {
  return MEDIA.test(p) || (LOCAL_ROOT.test(p) && /\.[a-z0-9]+$/i.test(p));
}

// A local file, keeping a trailing ?query and #anchor (page.html#built) as URL parts. The whole target
// wins when it names a file itself (/Users/me/a#b.html), so a literal # or ? in a filename stays encoded;
// otherwise the first ? or # after which the path still names a file starts the suffix.
function localFileUrl(target: string): string | undefined {
  if (isFile(target)) return fileUrl(target);
  for (const { index } of target.matchAll(/[?#]/g)) {
    const head = target.slice(0, index);
    if (isFile(head)) return fileUrl(head) + target.slice(index);
  }
  return LOCAL_ROOT.test(target) ? fileUrl(target) : undefined;
}

function fileUrl(p: string): string {
  return `file://${encodeURI(p).replace(/[?#]/g, encodeURIComponent)}`;
}
