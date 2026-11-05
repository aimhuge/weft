// Where a card's next message came from, for its <weft-env> block (docs/architecture/thread-env.md). An entry point
// notes it (the local messages route, a command's dispatch, a new card's body, the scheduler, Slack) and the runner
// takes it when the message goes to the CLI, so a message held for a slot or the turn's end keeps its sender. A
// message nobody noted is Weft's own: a queued skill, a resume, a Backlog card started, or a card's first turn made
// by a cron or another card, which the card itself says.
//
// A HINT for the model's benefit only (@weft/client's client-hint.ts): never read it for a check, a grant or a mode.
import { cleanTz, readClientHint, type ClientApp, type ClientHint } from "@weft/client";
import type { Card } from "./types";

export type TurnApp = ClientApp | "remote" | "local" | "cron" | "card" | "webhook" | "scheduled" | "weft";

export interface TurnClient {
  app: TurnApp;
  name?: string;
  tz?: string;
  via?: "line" | "relay";
  // The desktop board in this host's own window (the local route), not one reaching it over the network.
  here?: boolean;
}

const noted = new Map<string, TurnClient>();
let userTz: string | undefined;

/** Tests: forget every note and the user's time zone. */
export function resetTurnClients() {
  noted.clear();
  userTz = undefined;
}

/** The user's time zone as last reported by a client they wrote from, if any has said. */
export const lastUserTz = () => userTz;

export function noteClient(cardId: string, client: TurnClient | undefined) {
  if (!client) return;
  const tz = cleanTz(client.tz);
  if (tz) userTz = tz;
  noted.set(cardId, client);
}

/** The noted sender of the card's next message, taken (a later message is noted afresh, or is Weft's own). */
export function takeClient(cardId: string): TurnClient | undefined {
  const client = noted.get(cardId);
  noted.delete(cardId);
  return client;
}

const APPS: readonly string[] = ["desktop", "web", "phone", "remote", "local", "cron", "card", "webhook", "scheduled", "weft"];

/** A client an entry point put on a new card's body, checked like anything else in that body. */
export function asTurnClient(raw: unknown): TurnClient | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.app !== "string" || !APPS.includes(p.app)) return undefined;
  // Its name, zone and route cleaned as a wire hint's are; the app is checked against the wider list above.
  const hint = readClientHint({ ...p, app: "web" }) as ClientHint;
  return { ...hint, app: p.app as TurnApp, ...(p.here === true && { here: true }) };
}

/** A row's sender off the network: its hint when it gives a known one, else "remote" (an unstamped phone or board). */
export function commandClient(payload: unknown): TurnClient {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>).client : undefined;
  return readClientHint(raw) ?? { app: "remote" };
}

/** A message nobody noted: the card's own first turn says who made it, else it's Weft's own. */
export function impliedClient(card: Pick<Card, "cronId" | "cronRun" | "parentId" | "turns"> | undefined, parentTitle?: string): TurnClient {
  if (!card?.turns && card?.cronId) return { app: "cron", ...(card.cronRun !== undefined && { name: `run ${card.cronRun}` }) };
  if (!card?.turns && card?.parentId) return { app: "card", ...(parentTitle && { name: parentTitle }) };
  return { app: "weft" };
}

const quoted = (name: string | undefined) => (name ? ` "${name.replace(/["<>\n]/g, "").slice(0, 60)}"` : "");
const mac = (name: string | undefined) => (name ? ` on Mac ${name}` : "");

// The senders whose words don't depend on the hint's fields.
type FixedApp = Exclude<TurnApp, "desktop" | "card" | "cron" | "webhook">;
const FIXED: Record<FixedApp, string> = {
  web: "weft.zip in a browser",
  phone: "the Weft phone app",
  remote: "a remote board (weft.zip or the phone app; it didn't say which)",
  local: "a local process on this Mac (a thread's or script's call to Weft's API), not the board window",
  scheduled: "a message the user scheduled (Send later)",
  weft: "Weft itself (a queued, resumed or automatic message)",
};

const named = (what: string, name: string | undefined) => `${what}${name ? ` (${name})` : ""}`;

/** The client as the block's from: line says it. */
export function describeClient(c: TurnClient): string {
  const via = c.via ? ` over the ${c.via === "line" ? "session line" : "relay"}` : "";
  if (c.app === "desktop") return c.here ? named("the desktop board on this Mac", c.name) : `the desktop board${mac(c.name)}${via}`;
  if (c.app === "card") return `another card${quoted(c.name)} (create_card)`;
  if (c.app === "cron" || c.app === "webhook") return named(`a ${c.app}`, c.name);
  return `${FIXED[c.app]}${via}`;
}
