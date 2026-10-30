import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { cardProof } from "./card-token";
import { endGrantAtDone } from "./vault-grant-done";
import { recordExplore } from "./explore";
import { asText } from "./format";
import { addBlankTool, ASK_PROMPT, askAddTool, addMissingBlank, missingText } from "./secret-ask";
import { markInUse, RUN_PROMPT, runTool } from "./secret-run";
import { recordStep } from "./site-notes-trail";

// The vault for threads (docs/architecture/secrets.md): names only, and values typed into a pane field by
// Electron main after the user's Touch ID. A value never comes back through these tools.
export const SECRETS_PROMPT = `When a task needs a secret value the user keeps in Weft's 🔐 vault (an API key, an OAuth client secret, a password): don't ask them to paste it, don't read .env files, and never try to see the value. Call mcp__secrets__list for the names, open the page with the field in the browser pane, and call mcp__secrets__fill_field; the user approves with Touch ID and the value goes straight into the field.
${ASK_PROMPT}
${RUN_PROMPT}
When a task will use vault secrets many times (filling several dashboard pages, a run of commands, setting up a service), call mcp__secrets__request_access once, up front, before the first of them, with a why that names everything you'll do: one Touch ID lets this thread's fills, runs and dev server go without asking. Pass writes: true when you'll also store values with set_value or push them with push_to_vercel, and span: "thread" when the work will outlast an hour, so the user is asked once, not once per call. You still never see a value. If you will fill secrets into a page, pass its site too, so the approval names it and covers that page only.
To put a vault value on the project's linked Vercel project (an env var a deploy needs), call mcp__secrets__push_to_vercel with its name and environment; the user approves with Touch ID and Weft sends it to Vercel itself. Don't use the Vercel dashboard or \`vercel env add\` for a vault value.
When you generate a secret yourself (a random signing secret, a webhook secret you make up), call mcp__secrets__set_value with the name and the value right after you generate it (it adds the name or fills its blank): the user approves with Touch ID and Weft stores it; don't write it to a file or repeat it. A key the user gets from a provider stays a blank for them to fill in. To change a value that's already there to one you generated or got yourself (new price ids after moving Stripe to a sandbox, say), call mcp__secrets__set_value with replace: true; the user approves the overwrite with Touch ID.`;

const ENVIRONMENTS = ["development", "preview", "production"] as const;

type Listed = { name: string; environment: string; missing: boolean };

function describeList(label: string, secrets: Listed[]) {
  if (!secrets.length) return `The ${label} vault has no secrets yet. Ask the user to add them with 🔐 on the left rail.`;
  const lines = secrets.map((s) => `- ${s.name} (${s.environment})${s.missing ? ": blank, no value yet" : ""}`);
  return `Secrets in the ${label} vault (names only):\n${lines.join("\n")}`;
}

// A fresh server per query, like the browser's. folder is the card's project and title its name, read when a tool runs.
export function secretsMcpServer(cardId: () => string | undefined, folder: () => string, title: () => string | undefined = () => undefined) {
  const project = z.string().optional().describe("Absolute path of the project whose vault to use; defaults to this thread's folder");
  return createSdkMcpServer({
    name: "secrets",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool("list", "List the names in a project's 🔐 vault, with their environment and whether each has a value. Never values.", { project }, ({ project: p }) =>
        attempt(async () => {
          const r = await shell("/secrets/list", { folder: p ?? folder() });
          return text(describeList(asText(r.label), (r.secrets as Listed[] | undefined) ?? []));
        }),
      ),
      tool(
        "fill_field",
        "Type a secret from the 🔐 vault into the field matching a CSS selector in the browser pane (https pages only). The user approves with Touch ID; you never see the value, and read_page shows it as ‹NAME›.",
        {
          name: z.string().describe("The secret's name, e.g. GITHUB_CLIENT_SECRET"),
          selector: z.string().describe("CSS selector of the input to fill"),
          environment: z.enum(ENVIRONMENTS).optional().describe("Which value to use; defaults to development"),
          project,
        },
        ({ name, selector, environment, project: p }) =>
          attempt(async () => {
            const r = await shell("/secrets/fill", { ...cardProof(cardId(), "/secrets/fill"), thread: title(), folder: p ?? folder(), name, environment: environment ?? "development", selector });
            const vault = asText(r.label, "this");
            if (r.denied) return text(`The user didn't approve ${name}. Ask before trying again.`, true);
            if (r.missing) {
              const env = environment ?? "development";
              return text(missingText([name], env, vault, await addMissingBlank(p ?? folder(), name, env)), true);
            }
            if (!r.found) return text(`No element matches ${selector}`, true);
            markInUse(cardId());
            // The site notes keep the selector only, never the name or the value (lib/site-notes-trail.ts).
            recordStep(cardId(), "fill_field", { selector }, true);
            void recordExplore("vault");
            return text(`Typed ${name} from the ${vault} vault into ${selector}.`);
          }),
      ),
      tool(
        "push_to_vercel",
        "Push a secret from the 🔐 vault to the project's linked Vercel project as an environment variable (replacing Vercel's value for that environment). The user approves with Touch ID; you never see the value. Takes effect on the next deploy.",
        {
          name: z.string().describe("The secret's name, e.g. SUPABASE_SECRET_KEY"),
          environment: z.enum(ENVIRONMENTS).optional().describe("Which value, and which Vercel environment it goes to; defaults to production"),
          project,
        },
        ({ name, environment, project: p }) =>
          attempt(async () => {
            const env = environment ?? "production";
            const r = await shell("/vercel/env-push", { ...cardProof(cardId(), "/vercel/env-push"), folder: p ?? folder(), name, environment: env });
            const vault = asText(r.label, "this");
            if (r.denied) return text(`The user didn't approve pushing ${name}. Ask before trying again.`, true);
            if (r.missing) return text(missingText([name], env, vault, await addMissingBlank(p ?? folder(), name, env)), true);
            return text(`Pushed ${name} (${env}) from the ${vault} vault to Vercel project ${asText(r.project, "the linked project")}. It takes effect on the next deploy.`);
          }),
      ),
      tool(
        "set_value",
        "Store a value you generated (a random signing secret, say) in the 🔐 vault: it adds the name, or fills it when it's a blank. With replace: true it overwrites the value a name already has in that environment (one you generated or got yourself, like new price ids); the Touch ID approval says it overwrites. The user approves with Touch ID; the result never repeats the value. For keys the user gets from a provider, leave the blank for them.",
        {
          name: z.string().describe("The secret's name, e.g. PUKU_TRIAL_SIGNING_SECRET"),
          value: z.string().min(1).describe("The value you generated"),
          environment: z.enum(ENVIRONMENTS).optional().describe("Which environment it's for; defaults to development"),
          replace: z.boolean().optional().describe("Overwrite the value the name already has in that environment; without it only a blank takes a value"),
          project,
        },
        ({ name, value, environment, replace, project: p }) =>
          attempt(async () => {
            const env = environment ?? "development";
            const r = await shell("/secrets/set", { ...cardProof(cardId(), "/secrets/set"), folder: p ?? folder(), name, value, environment: env, ...(replace ? { replace: true } : {}) });
            const vault = asText(r.label, "this");
            if (r.denied) return text(`The user didn't approve ${replace ? "replacing" : "setting"} ${name}. Ask before trying again.`, true);
            if (r.filled) return text(`${name} already has a value in the ${vault} vault (${env}); set_value only fills blanks unless you pass replace: true. Call it again with replace: true if the new value should overwrite it; the user approves the overwrite with Touch ID.`, true);
            if (r.replaced) return text(`Replaced the value of ${name} in the ${vault} vault (${env}).`);
            if (r.added) return text(`Added ${name} to the ${vault} vault (${env}).`);
            return text(`Set ${name} in the ${vault} vault (${env}).`);
          }),
      ),
      tool(
        "request_access",
        "Ask the user for standing access to a project's 🔐 vault: one Touch ID, then this thread's fill_field, run and dev server use its secrets without asking each time. Call it once, before a multi-step setup, naming everything in why. writes: true also covers set_value and push_to_vercel (an overwrite still asks); span: \"thread\" lasts until this card is Done instead of an hour. You still never see a value. Name the site when you will be filling secrets into a page: the approval says which page, and the access covers that page only.",
        {
          why: z.string().describe("One short sentence the user reads in the approval: what you'll use the secrets for"),
          site: z.string().optional().describe("The page's host, e.g. dashboard.stripe.com, if you'll fill secrets into it"),
          writes: z.boolean().optional().describe("Also store values you make (set_value) and push them to Vercel (push_to_vercel) without asking each time"),
          span: z.enum(["hour", "thread"]).optional().describe("hour (default), or thread: until this card is Done"),
          project,
        },
        ({ why, site, writes, span, project: p }) =>
          attempt(async () => {
            const r = await shell("/secrets/request-access", { ...cardProof(cardId(), "/secrets/request-access"), thread: title(), folder: p ?? folder(), why, site, writes: writes === true, span: span ?? "hour" });
            const vault = asText(r.label, "this");
            if (!r.granted) return text(`The user didn't give standing access to the ${vault} vault. Each use will ask for Touch ID instead.`, true);
            if (r.span === "thread") endGrantAtDone(cardId());
            const where = site ? ` into ${site}` : "";
            const how = r.span === "thread" ? "Until this card is Done" : "For the next hour";
            const what = r.writes ? "fill_field, run, the dev server, set_value (not overwrites) and push_to_vercel" : "fill_field, run and the dev server";
            return text(`${how} this thread can use the ${vault} vault's secrets without asking${where}: ${what}.`);
          }),
      ),
      addBlankTool(folder),
      askAddTool(folder),
      runTool(cardId, folder, title),
    ],
  });
}
