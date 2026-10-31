import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { closeTunnel, DEFAULT_HOURS, listTunnels, MAX_HOURS, openTunnel } from "./tunnels";
import { createRelay } from "./webhook-forward";
import { addWebhook, listWebhooks, updateWebhook, type Webhook } from "./webhooks";

// The 🪝 webhooks for threads (docs/architecture/webhooks.md): a thread records the routes providers post to as
// blanks, the rail counts them, and the user (or the thread) registers them when ready. These run in the Next
// server, so they use lib/webhooks.ts directly; only ask_add reaches the board, through the desktop shell.
export const WEBHOOKS_PROMPT = `When the code you write receives webhooks (a route a provider such as Stripe, GitHub or Resend posts to), record each one as soon as you know its route with mcp__webhooks__add_blank: a name, the route (a path like /api/stripe/webhook), the provider's events, a hint where to register it, and the vault name of its signing secret. The user sees the blanks counted on 🪝 on the left rail. A dev server on localhost can't be reached from outside, so call mcp__webhooks__relay for a public URL on Weft that forwards deliveries to it while Weft runs, and register that URL with the provider yourself when you can (its CLI or API, or its dashboard in the browser pane), then call mcp__webhooks__mark_registered. Only when you're blocked on a webhook being registered right now, call mcp__webhooks__ask_add: it adds the blank too and opens the 🪝 drawer on it. Never invent a tunnel (ngrok and the like): relay covers a provider's deliveries, and when something else needs a dev server from outside this Mac (a page on a phone, an OAuth callback), mcp__webhooks__tunnel gives it a private address, after the user's Touch ID. Close it with mcp__webhooks__close_tunnel when you're done.`;

const PROJECT = z.string().optional().describe("Absolute path of the project the webhook belongs to; defaults to this thread's folder");
const NAME = z.string().min(1).max(60).describe("What it's for, e.g. stripe; one per name in a project");
const FIELDS = {
  name: NAME,
  target: z.string().describe("The local route it reaches: a path like /api/stripe/webhook, or a localhost URL"),
  events: z.array(z.string()).max(50).optional().describe("The provider's events it should send, e.g. [\"checkout.session.completed\"]"),
  hint: z.string().max(200).optional().describe("Where to register it, e.g. \"Stripe dashboard → Developers → Webhooks\""),
  secret: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Letters, digits and _, not starting with a digit").optional().describe("The vault name of its signing secret, e.g. STRIPE_WEBHOOK_SECRET"),
  provider: z.enum(["stripe", "github", "vercel", "svix"]).optional().describe("The provider whose signature the relay verifies (default: lowercased name). Resend and Clerk are 'svix'. Required for a public relay URL."),
  project: PROJECT,
};

type AddArgs = { name: string; target: string; events?: string[]; hint?: string; secret?: string; provider?: string; project?: string };

function describeHook(h: Webhook) {
  const last = h.deliveries?.[0];
  const parts = [
    `target ${h.target}`,
    h.registered ? "registered" : "blank, not registered yet",
    h.events?.length ? `events ${h.events.join(", ")}` : "",
    h.url ? `relay ${h.url}` : "no relay",
    h.secret ? `secret ${h.secret}` : "",
    h.provider ? `provider ${h.provider}` : "",
    last ? `last delivery ${last.status || "unreachable"}` : "",
  ].filter(Boolean);
  return `- ${h.name}: ${parts.join("; ")}`;
}

function findHook(folder: string, name: string): Webhook {
  const hook = listWebhooks([folder]).find((h) => h.name.toLowerCase() === name.trim().toLowerCase());
  if (!hook) throw new Error(`No webhook “${name}” in this project. mcp__webhooks__list shows them; add one with mcp__webhooks__add_blank.`);
  return hook;
}

// Records the webhook (and, best effort, its signing secret as a vault blank).
async function record(folder: string, a: AddArgs) {
  const added = addWebhook({ folder, name: a.name, target: a.target, events: a.events, hint: a.hint, secret: a.secret, provider: a.provider });
  if (a.secret) await shell("/secrets/add-blank", { folder, names: [a.secret], environment: "development", hint: a.hint }).catch(() => null);
  return added;
}

/** mcp__webhooks__*. folder is the card's project, read when a tool runs. */
export function webhooksMcpServer(folder: () => string) {
  const where = (p?: string) => p ?? folder();
  return createSdkMcpServer({
    name: "webhooks",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool("list", "List a project's 🪝 webhooks: name, target route, events, registered or blank, relay URL, secret name and the last delivery's status.", { project: PROJECT }, ({ project }) =>
        attempt(() => {
          const hooks = listWebhooks([where(project)]);
          if (!hooks.length) return Promise.resolve(text("This project has no webhooks yet. Record one with mcp__webhooks__add_blank."));
          return Promise.resolve(text(`Webhooks in this project:\n${hooks.map(describeHook).join("\n")}`));
        }),
      ),
      tool(
        "add_blank",
        "Record a webhook the code needs, for the user to register with the provider when they're ready: the default whenever you write a route a provider posts to. The rail's 🪝 counts it. The same name in a project updates it. A secret name is also put in the 🔐 vault as a blank.",
        FIELDS,
        (a) =>
          attempt(async () => {
            const { hook, existed } = await record(where(a.project), a);
            return text(
              `${hook.name} ${existed ? "is updated" : "is a blank"} on 🪝 now (${hook.target}); the user registers it with the provider when they're ready. Carry on with what doesn't need it. For a public URL that forwards to ${hook.target}, call mcp__webhooks__relay.`,
            );
          }),
      ),
      tool(
        "ask_add",
        "Add a webhook like add_blank and open the 🪝 drawer on it, for one you're blocked on being registered right now. When you can carry on without it, use add_blank instead.",
        FIELDS,
        (a) =>
          attempt(async () => {
            const dir = where(a.project);
            const { hook } = await record(dir, a);
            await shell("/webhooks/ask-add", { folder: dir, id: hook.id });
            return text(`Opened the 🪝 drawer on ${hook.name}. Ask the user to register it with the provider (mcp__webhooks__relay gives it a public URL); mcp__webhooks__list shows when it's registered.`);
          }),
      ),
      tool(
        "relay",
        "Give a webhook a public URL on Weft to register with the provider (paste it into its dashboard, or use its CLI or API). Deliveries forward to the webhook's target while Weft runs. Needs the user signed in to a Weft account, and the webhook must name a known provider (stripe, github, vercel, svix — Resend and Clerk are svix) plus the vault name of its signing secret, since the relay only accepts deliveries carrying the provider's signature. The user approves the secret being sealed with one Touch ID.",
        { name: NAME, project: PROJECT },
        ({ name, project }) =>
          attempt(async () => {
            const hook = await createRelay(findHook(where(project), name).id);
            return text(
              `${hook.name} has a public URL: ${hook.url}\nRegister it with the provider${hook.hint ? ` (${hook.hint})` : ""}. Deliveries forward to ${hook.target} while Weft runs. Once it's registered, call mcp__webhooks__mark_registered.`,
            );
          }),
      ),
      tool(
        "tunnel",
        "Open a private address for a local dev server, reachable from outside this Mac: live pages, hot reload and webhook replies. Only the signed-in owner gets in. The user approves with Touch ID. It closes by itself after hours. Tiny streamed chunks arrive late and all at once, so a streaming AI reply won't type out.",
        { target: z.string().describe("The dev server, e.g. http://localhost:3000"), hours: z.number().min(0.25).max(MAX_HOURS).optional().describe(`Hours until it closes; defaults to ${DEFAULT_HOURS}`), project: PROJECT },
        ({ target, hours, project }) =>
          attempt(async () => {
            const t = await openTunnel({ folder: where(project), target, hours });
            return text(`${t.target} is open at ${t.address}, for you only, until ${new Date(t.expiresAt).toLocaleTimeString()}. Relays to this server now answer through it.`);
          }),
      ),
      tool("close_tunnel", "Close this project's tunnel to a local dev server right away.", { target: z.string().describe("The dev server, e.g. http://localhost:3000"), project: PROJECT }, ({ target, project }) =>
        attempt(async () => {
          const wanted = new URL(target).origin;
          const open = listTunnels([where(project)]).find((t) => new URL(t.target).origin === wanted);
          if (!open) return text(`No tunnel is open to ${target} in this project.`);
          await closeTunnel(open.id);
          return text(`Closed the tunnel to ${open.target}.`);
        }),
      ),
      tool("mark_registered", "Mark a webhook registered, after you registered it with the provider yourself.", { name: NAME, project: PROJECT }, ({ name, project }) =>
        attempt(() => {
          const hook = updateWebhook(findHook(where(project), name).id, { registered: true });
          return Promise.resolve(text(`${hook.name} is registered; 🪝 no longer counts it as a blank.`));
        }),
      ),
    ],
  });
}
