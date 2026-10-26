import { folderName, timeAgo } from "./format";
import { validName } from "./vault-view";
import type { Delivery, Webhook } from "./webhook-types";

// What the 🪝 drawer and its rail icon show (components/WebhooksDrawer.tsx), from the registry
// (lib/webhooks.ts, GET /api/webhooks). Pure and browser-safe: only types come from lib/webhooks.ts, which
// reads the disk.

// A thread asking the user to register a webhook it added (mcp__webhooks__ask_add, main's "add-webhook"
// message): the drawer opens with that row expanded so the user can copy its URL.
export interface WebhookAsk {
  folder: string;
  id: string;
}

export function parseWebhookAsk(payload: string | undefined): WebhookAsk | undefined {
  if (!payload) return undefined;
  let ask: Partial<WebhookAsk> | null;
  try {
    ask = JSON.parse(payload) as Partial<WebhookAsk> | null;
  } catch {
    return undefined;
  }
  if (typeof ask?.folder !== "string" || typeof ask.id !== "string" || !ask.id) return undefined;
  return { folder: ask.folder, id: ask.id };
}

// The provider doesn't send to it yet.
export const isBlank = (h: Pick<Webhook, "registered">) => !h.registered;

// The rail icon's count: webhooks still to register with their provider.
export const blankCount = (hooks: readonly Pick<Webhook, "registered">[]) => hooks.filter(isBlank).length;

export const deliveryOk = (d: Pick<Delivery, "status">) => d.status >= 200 && d.status < 300;

// Its latest delivery went wrong: a non-2xx answer, or the local route wasn't reachable.
export const isFailing = (h: Pick<Webhook, "deliveries">) => {
  const last = h.deliveries?.[0];
  return Boolean(last && !deliveryOk(last));
};

export const failingCount = (hooks: readonly Pick<Webhook, "deliveries">[]) => hooks.filter(isFailing).length;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The rail icon's hover text.
export function webhooksTitle({ blanks, failing }: { blanks: number; failing: number }) {
  const parts = ["Webhooks: what providers post to this project"];
  if (blanks) parts.push(`${plural(blanks, "blank")} to register`);
  if (failing) parts.push(`${failing} failing`);
  return parts.join(" · ");
}

// The webhooks of one folder, or all of them. Unlike the vault, no two folders share a list.
export function filterWebhooks<T extends Pick<Webhook, "folder">>(hooks: readonly T[], project: string | null): T[] {
  return project ? hooks.filter((h) => h.folder === project) : [...hooks];
}

export interface WebhookSection {
  folder: string;
  label: string;
  hooks: Webhook[];
}

// One section per folder (every one given, also with no webhook yet, so it can be added to), by name, each with
// its hooks by name. A hook in a folder that isn't listed gets its own section after them.
export function groupByFolder(hooks: readonly Webhook[], folders: readonly string[]): WebhookSection[] {
  const all = [...folders, ...hooks.map((h) => h.folder).filter((f) => !folders.includes(f))];
  return [...new Set(all)]
    .map((folder) => ({
      folder,
      label: folderName(folder),
      hooks: hooks.filter((h) => h.folder === folder).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.folder.localeCompare(b.folder));
}

// The project filter's choices: "All projects", then each folder by name.
export function folderOptions(folders: readonly string[]) {
  return [{ folder: "", label: "All projects" }, ...groupByFolder([], folders).map((s) => ({ folder: s.folder, label: s.label }))];
}

// "http://localhost:3000/api/stripe/webhook" -> "/api/stripe/webhook"; another port keeps its host.
export function shortTarget(target: string) {
  try {
    const url = new URL(target);
    const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
    if (url.origin === "http://localhost:3000") return path || "/";
    return `${url.host}${path}`;
  } catch {
    return target;
  }
}

// "3 events", "1 event", or null when it takes whatever the provider sends.
export const eventsText = (events: readonly string[] | undefined) => (events?.length ? plural(events.length, "event") : null);

// A delivery as one phrase: "200 · 2m ago", or "unreachable · 2m ago" when the local route didn't answer.
export function deliveryLabel(d: Delivery, now = Date.now()) {
  return `${d.status === 0 ? "unreachable" : d.status} · ${timeAgo(d.at, now)}`;
}

// The longer version for a delivery's hover text.
export function deliveryTitle(d: Delivery) {
  return [`${d.method} ${d.status === 0 ? "to an unreachable route" : `answered ${d.status}`} in ${d.ms}ms`, d.error].filter(Boolean).join("\n");
}

// What the expanded row offers for the public URL: copy it, get one, or sign in first (relays live on the
// deployed Weft, behind a Weft account).
export type RelayState = "url" | "get" | "sign-in";

export function relayState(h: Pick<Webhook, "url">, signedIn: boolean): RelayState {
  if (h.url) return "url";
  return signedIn ? "get" : "sign-in";
}

// The webhooks list with one added or replaced (what a POST or PATCH answered), without asking again.
export function upsertWebhook(hooks: readonly Webhook[], hook: Webhook): Webhook[] {
  return hooks.some((h) => h.id === hook.id) ? hooks.map((h) => (h.id === hook.id ? hook : h)) : [...hooks, hook];
}

// "a, b ,a" -> ["a", "b"].
export function parseEvents(text: string): string[] {
  return [...new Set(text.split(",").map((e) => e.trim()).filter(Boolean))];
}

// The Add form's fields, as typed.
export interface WebhookForm {
  name: string;
  target: string;
  events: string;
  hint: string;
  secret: string;
}

export const emptyForm = (): WebhookForm => ({ name: "", target: "", events: "", hint: "", secret: "" });

export const badSecretName = (form: Pick<WebhookForm, "secret">) => form.secret.trim() !== "" && !validName(form.secret.trim());

export const formReady = (form: WebhookForm) => form.name.trim() !== "" && form.target.trim() !== "" && !badSecretName(form);

// The body of POST /api/webhooks: only what was typed.
export function formInput(folder: string, form: WebhookForm) {
  const events = parseEvents(form.events);
  return {
    folder,
    name: form.name.trim(),
    target: form.target.trim(),
    ...(events.length && { events }),
    ...(form.hint.trim() && { hint: form.hint.trim() }),
    ...(form.secret.trim() && { secret: form.secret.trim() }),
  };
}
