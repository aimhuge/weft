import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { asText } from "./format";

// mcp__secrets__set_values (docs/architecture/secrets.md): several values a thread generated, stored after ONE
// Touch ID in Electron main (fillMany in electron/vault-routes.cjs) that names every secret and environment and says
// which overwrite. The answer names what happened to each; a value never comes back.
export const ENVIRONMENTS = ["development", "preview", "production"] as const;
export const MAX_SET_VALUES = 20;

export const SET_VALUES_PROMPT = `When you have several secrets to store at once (setting a project up: signing secrets, webhook secrets, price ids), call mcp__secrets__set_values once with all of them instead of set_value for each: the user approves the lot with one Touch ID that lists every name and environment, and which ones overwrite.`;

type Named = { name: string; environment: string };
type Answer = { label?: string; denied?: boolean; added?: Named[]; set?: Named[]; replaced?: Named[]; filled?: Named[] };

const names = (list: Named[] | undefined) => (list ?? []).map((n) => `${n.name} (${n.environment})`).join(", ");

function describe(r: Answer): string[] {
  const vault = asText(r.label, "this");
  return [
    r.added?.length ? `Added to the ${vault} vault: ${names(r.added)}.` : "",
    r.set?.length ? `Set in the ${vault} vault: ${names(r.set)}.` : "",
    r.replaced?.length ? `Replaced in the ${vault} vault: ${names(r.replaced)}.` : "",
    r.filled?.length
      ? `Left alone, since they already have a value: ${names(r.filled)}. Pass replace: true on those entries if the new values should overwrite them; the user approves the overwrite with Touch ID.`
      : "",
  ].filter(Boolean);
}

export function setValuesTool(folder: () => string) {
  return tool(
    "set_values",
    `Store several values you generated in the 🔐 vault with ONE Touch ID: like set_value for each (adds a name, fills a blank, overwrites only with replace: true), but the user approves them all at once. Up to ${MAX_SET_VALUES}. The result never repeats a value. For keys the user gets from a provider, leave blanks for them.`,
    {
      secrets: z
        .array(
          z.object({
            name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Letters, digits and _, not starting with a digit").describe("The secret's name"),
            value: z.string().min(1).describe("The value you generated"),
            environment: z.enum(ENVIRONMENTS).optional().describe("Defaults to the call's environment"),
            replace: z.boolean().optional().describe("Overwrite the value this name already has in that environment"),
          }),
        )
        .min(1)
        .max(MAX_SET_VALUES)
        .describe("The secrets to store, e.g. [{name: \"SIGNING_SECRET\", value: \"…\"}, {name: \"CRON_SECRET\", value: \"…\"}]"),
      environment: z.enum(ENVIRONMENTS).optional().describe("The environment for entries that don't name one; defaults to development"),
      project: z.string().optional().describe("Absolute path of the project whose vault to use; defaults to this thread's folder"),
    },
    ({ secrets, environment, project }) =>
      attempt(async () => {
        const env = environment ?? "development";
        const entries = secrets.map((s) => ({ name: s.name, value: s.value, environment: s.environment ?? env, ...(s.replace ? { replace: true } : {}) }));
        const r = (await shell("/secrets/set-many", { folder: project ?? folder(), secrets: entries })) as Answer;
        if (r.denied) return text(`The user didn't approve storing ${names(entries)}. Nothing was written. Ask before trying again.`, true);
        const wrote = (r.added?.length ?? 0) + (r.set?.length ?? 0) + (r.replaced?.length ?? 0);
        return text(describe(r).join("\n"), wrote === 0);
      }),
  );
}
