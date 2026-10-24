import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { asText } from "./format";

// A key a thread needs that isn't in the 🔐 vault yet (docs/architecture/secrets.md). By default the thread
// puts its name in as a blank (mcp__secrets__add_blank): the rail's 🔐 counts it and the user fills it in when
// they're ready. Blocked on it now, the thread asks (mcp__secrets__ask_add): Electron main adds the blank, and the
// thread shows an input for that key in place of the call (components/SecretAskInput.tsx), so the user pastes the
// value where they're already reading. The value goes from that input to Electron main, never back to the thread.

export const ASK_PROMPT = `When the work needs a secret that isn't in the vault yet (code reads process.env.SOMETHING, an SDK or service wants a key, a dashboard step needs a client secret), put each name in the 🔐 vault as a blank right away with mcp__secrets__add_blank, with a hint for where to get its value and the direct https link to that page (it opens in the browser pane from the drawer). Do it as soon as you know the name, before you need the value, and keep going with what doesn't need it: the user sees the blanks counted on 🔐 and fills them in when they're ready. Never make up placeholder values or write keys into files. Only when you're blocked on a value right now, call mcp__secrets__ask_add with its name, then end your turn: the user gets an input for it right in this thread, and tells you once it's in. Don't walk them through the drawer yourself.`;

const ENVIRONMENTS = ["development", "preview", "production"] as const;
type Environment = (typeof ENVIRONMENTS)[number];
const NAME = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Letters, digits and _, not starting with a digit");
const PROJECT = z.string().optional().describe("Absolute path of the project whose vault to use; defaults to this thread's folder");

// Puts a missing name in as a blank; false when Electron main can't be reached (only the desktop app has it).
export async function addMissingBlank(folder: string, name: string, environment: Environment = "development"): Promise<boolean> {
  try {
    await shell("/secrets/ask-add", { folder, name, environment });
    return true;
  } catch {
    return false;
  }
}

// What a thread hears when names have no value: they're blanks now and ask_add asks for one in the thread, or,
// when main couldn't be reached, where the user adds them by hand.
export function missingText(names: string[], environment: string, vault: string, added: boolean): string {
  const many = names.length > 1;
  const lack = `${names.join(", ")} ${many ? "have" : "has"} no value in the ${vault} vault (${environment}).`;
  if (!added) return `${lack} Ask the user to add ${many ? "them" : "it"} with 🔐 on the left rail.`;
  return `${lack} ${many ? "They're blanks" : "It's a blank"} there now. If you're blocked on ${many ? "them" : "it"}, call mcp__secrets__ask_add for ${many ? "each" : names[0]} and end your turn: the user gets an input for it in this thread and tells you once it's in.`;
}

/** mcp__secrets__ask_add. folder is the card's project, read when the tool runs. */
export function askAddTool(folder: () => string) {
  return tool(
    "ask_add",
    "Ask the user for a key you're blocked on right now: its name goes in the 🔐 vault as a blank and this thread shows an input for it, where the user pastes the value; you never see it. End your turn after calling it; the user tells you once it's in. When you can carry on without the value, use add_blank instead. A name that already has a value keeps it (the answer says so); to replace a value you generated or got yourself, use set_value with replace: true.",
    {
      name: NAME.describe("The secret's name, e.g. SUPABASE_SECRET_KEY"),
      environment: z.enum(ENVIRONMENTS).optional().describe("Which environment it's for; defaults to development"),
      project: PROJECT,
    },
    ({ name, environment, project }) =>
      attempt(async () => {
        const env = environment ?? "development";
        const r = await shell("/secrets/ask-add", { folder: project ?? folder(), name, environment: env });
        if (r.filled) return text(filledAskText(name, env, asText(r.label, "this")), true);
        return text(`${name} (${environment ?? "development"}) is a blank in the 🔐 vault, and this thread shows the user an input for it. End your turn now; they'll tell you once it's in.`);
      }),
  );
}

// What ask_add says for a name that already has a value: nothing changed, so it isn't a blank and the user has
// nothing to paste. How to change it instead.
export function filledAskText(name: string, environment: string, vault: string): string {
  return `${name} already has a value in the ${vault} vault (${environment}), so nothing changed: it isn't a blank and the user has nothing to paste. Carry on with that value. If it should change to one you generated or got yourself, call mcp__secrets__set_value with replace: true; if the user has to supply the new value, ask them to change it in 🔐.`;
}

/** mcp__secrets__add_blank: names into the vault with no value, nothing opens. folder is the card's project. */
export function addBlankTool(folder: () => string) {
  return tool(
    "add_blank",
    "Put secret names in the 🔐 vault as blanks (no value yet) for the user to fill in when they're ready: the default whenever the work needs a key that isn't in the vault. A name that already has a value keeps it. Nothing opens; you never see the values.",
    {
      names: z.array(NAME).min(1).max(20).describe("The secrets' names, e.g. [\"STRIPE_SECRET_KEY\", \"STRIPE_WEBHOOK_SECRET\"]"),
      hint: z.string().max(400).optional().describe("Where the user gets the values, shown in full under each blank: the path plus the direct https link to that page, which opens in the browser pane, e.g. \"Stripe → Developers → API keys: https://dashboard.stripe.com/apikeys\""),
      environment: z.enum(ENVIRONMENTS).optional().describe("Which environment they're for; defaults to development"),
      project: PROJECT,
    },
    ({ names, hint, environment, project }) =>
      attempt(async () => {
        const env = environment ?? "development";
        const r = await shell("/secrets/add-blank", { folder: project ?? folder(), names, environment: env, hint });
        return text(blankText(names, env, asText(r.label, "this"), Array.isArray(r.filled) ? r.filled.map(String) : []));
      }),
  );
}

// What a thread hears after add_blank: which names are blanks now, and which already had a value.
export function blankText(names: string[], environment: string, vault: string, filled: string[]): string {
  const had = new Set(filled);
  const blank = names.filter((n) => !had.has(n));
  const parts: string[] = [];
  if (blank.length) parts.push(`${blank.join(", ")} ${blank.length > 1 ? "are blanks" : "is a blank"} in the ${vault} vault (${environment}) now; the user fills ${blank.length > 1 ? "them" : "it"} in from 🔐. Carry on with what doesn't need ${blank.length > 1 ? "them" : "it"}, and check mcp__secrets__list before you use ${blank.length > 1 ? "them" : "it"}.`);
  if (had.size) parts.push(`${[...had].join(", ")} already ${had.size > 1 ? "have values" : "has a value"} there.`);
  return parts.join(" ");
}
