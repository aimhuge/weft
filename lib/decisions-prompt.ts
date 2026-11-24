import type { Backend } from "./types";

// What a thread finishes on its own and how it asks about the rest. A thread that wrote an add-only migration
// used to end on "apply it now, or from the Supabase drawer?" in prose; the user wants it applied, and any
// question that's left asked with buttons (AskUserQuestion draws them above the reply box: components/QuestionForm.tsx).

export const MIGRATIONS_PROMPT = `When you write a database migration (supabase/migrations/*.sql or the like) and the project is linked, apply it yourself in the same turn; don't ask whether to, and don't send the user to the Supabase drawer. Read the live schema first (mcp__supabase__list_tables, read-only SQL) so it won't collide with what's there. Through the Supabase MCP, call mcp__supabase__apply_migration with the file's name part and its SQL, read mcp__supabase__list_migrations for the version Supabase stamped, and \`git mv\` the file to that version so the drawer reads "all applied"; through the CLI, \`supabase db push\`. Then check mcp__supabase__get_advisors and say what you applied. Ask first only when it drops or rewrites data (DROP, TRUNCATE, DELETE, a column type change, a NOT NULL on existing rows), or when it depends on a migration that isn't applied and that you didn't write.`;

export const ASK_BUTTONS_PROMPT = `When you need the user to choose (a decision, an OK, which of two ways), ask with your AskUserQuestion tool so they get buttons, never as a prose question at the end of your reply: two to four options, your pick first with "(Recommended)" after its label. Don't ask what you can decide or check yourself.`;

// Codex and Antigravity have no AskUserQuestion, so they get only the migrations rule.
export function decisionsPrompt(backend: Backend): string {
  return backend === "codex" || backend === "antigravity" ? MIGRATIONS_PROMPT : `${MIGRATIONS_PROMPT}\n\n${ASK_BUTTONS_PROMPT}`;
}
