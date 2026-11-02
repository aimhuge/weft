// A "prompt matches" rule's pattern, run so it can't hang the server (docs/architecture/project-hosts.md#settings-on-a-worker-wp3).
// A rule comes from Settings, and on a worker from your synced settings, and JavaScript's regex engine backtracks: a
// pattern like (a+)+$ against a long prompt runs for minutes and holds the whole process with it. So a pattern is capped
// in length, and each test runs in a vm context with a timeout, which V8 enforces inside the regex engine too; one that
// runs out never matches. A test costs about 0.05 ms more than a plain one.
import vm from "node:vm";

export const MAX_PATTERN = 300;
export const MATCH_MS = 50;

const context = vm.createContext(Object.create(null) as object);
const script = new vm.Script("re.test(text)");

/** Why a pattern can't be a rule's, or null: empty, too long, or not a regex. */
export function patternProblem(source: string): string | null {
  if (!source.trim()) return "Enter a pattern";
  if (source.length > MAX_PATTERN) return `Keep the pattern under ${MAX_PATTERN} characters`;
  try {
    new RegExp(source, "i");
    return null;
  } catch {
    return `“${source.slice(0, 60)}” isn't a valid pattern`;
  }
}

/** Whether `re` matches `text`, false when it takes longer than `ms` (a catastrophic pattern). */
export function safeTest(re: RegExp, text: string, ms = MATCH_MS): boolean {
  const scope = context as { re?: RegExp; text?: string };
  scope.re = re;
  scope.text = text;
  try {
    return script.runInContext(context, { timeout: ms }) === true;
  } catch {
    return false;
  } finally {
    delete scope.re;
    delete scope.text;
  }
}
