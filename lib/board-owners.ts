// Whose work a card is and which machine runs it, for the board's person and machine filters. Both boards draw the
// same two pickers (components/OwnerFilter.tsx) and keep them in the URL (?who=…&on=…, lib/use-owner-filter-url.ts):
// the desktop board over Card.team (a teammate's card, lib/team-board.ts) and worker:// folders, weft.zip's over each
// cloud_cards row's owner_user and owner_device with names the page reads for it (lib/board-directory.ts).
// Pure, so it's tested here and safe in the browser.
import type { Card, TeamMark } from "./types";
import { parseWorkerProject } from "./worker-project";

// You, on every board: what ?who=me means, so a link to "my cards" works for whoever opens it.
export const ME = "me";
// This Mac on the desktop board, which runs your own local cards.
export const HERE = "here";

// Who a card belongs to (ME or their account id) and the machine that runs it (HERE, a Mac's device id, or
// `worker:<id>` for a Weft Worker, as cloud_cards.owner_device writes it).
export interface CardPlace {
  who: string;
  on: string;
}

export type MachineKind = "mac" | "worker";

export interface PersonChoice {
  id: string;
  label: string;
  avatar?: string | null;
  count: number;
}

export interface MachineChoice {
  id: string;
  label: string;
  kind: MachineKind;
  count: number;
}

// What the pickers offer: everyone with a card on the board, and the machines running them.
export interface OwnerChoices {
  people: PersonChoice[];
  machines: MachineChoice[];
}

// The names a board knows: people by account id, machines by their id.
export interface OwnerNames {
  person: (id: string) => { name: string; avatar?: string | null } | undefined;
  machine: (id: string) => string | undefined;
}

export const machineKind = (id: string): MachineKind => (id.startsWith("worker:") ? "worker" : "mac");

// A desktop card's place: a teammate's runs on their Mac, a worker:// one on that worker, the rest here.
export function cardPlace(card: Pick<Card, "cwd" | "team">): CardPlace {
  if (card.team) return { who: card.team.owner, on: card.team.device };
  const worker = parseWorkerProject(card.cwd);
  return { who: ME, on: worker ? `worker:${worker.workerId}` : HERE };
}

// A filter keeps a card when it names neither, or the card's place matches what it names.
export function matchesPlace(place: CardPlace, filter: { who?: string; on?: string }): boolean {
  return (!filter.who || place.who === filter.who) && (!filter.on || place.on === filter.on);
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

// "Weft on MacBook-Air-3.local" → "MacBook-Air-3": the devices table's default name, cut to the machine's own.
export function machineName(raw: string | null | undefined): string | undefined {
  const name = raw?.replace(/^Weft on\s+/i, "").replace(/\.local$/i, "").trim();
  return name || undefined;
}

// The pickers' options, counted from the board's cards (archived ones aren't on screen, so they don't count). You come
// first, then teammates by name; machines are the chosen person's only, This Mac first, then by name. A machine the
// board has no name for reads as its owner's ("Alex's Mac") or a short id.
export function ownerChoices<T extends Pick<Card, "archived">>(cards: readonly T[], placeOf: (card: T) => CardPlace, names: OwnerNames, who?: string): OwnerChoices {
  const people = new Map<string, PersonChoice>();
  const machines = new Map<string, MachineChoice & { owner: string }>();
  for (const card of cards) {
    if (card.archived) continue;
    const place = placeOf(card);
    const person = people.get(place.who) ?? { id: place.who, ...personLabel(place.who, names), count: 0 };
    person.count++;
    people.set(place.who, person);
    if (who && place.who !== who) continue;
    const machine = machines.get(place.on) ?? { id: place.on, label: "", kind: machineKind(place.on), count: 0, owner: place.who };
    machine.count++;
    machines.set(place.on, machine);
  }
  const labelled = [...machines.values()].map(({ owner, ...m }) => ({ ...m, label: machineLabel(m.id, owner, names) }));
  return {
    people: [...people.values()].sort((a, b) => Number(b.id === ME) - Number(a.id === ME) || a.label.localeCompare(b.label)),
    machines: labelled.sort((a, b) => Number(b.id === HERE) - Number(a.id === HERE) || a.label.localeCompare(b.label)),
  };
}

function personLabel(id: string, names: OwnerNames): { label: string; avatar?: string | null } {
  if (id === ME) return { label: "You" };
  const known = names.person(id);
  return known ? { label: known.name, avatar: known.avatar } : { label: "A teammate" };
}

function machineLabel(id: string, owner: string, names: OwnerNames): string {
  if (id === HERE) return "This Mac";
  const known = names.machine(id);
  if (known) return known;
  const kind = machineKind(id) === "worker" ? "Worker" : "Mac";
  if (owner === ME) return `Your ${kind} ${id.replace(/^worker:/, "").slice(0, 6)}`;
  const person = names.person(owner);
  return `${person ? first(person.name) : "A teammate"}'s ${kind}`;
}

// The desktop board's names: teammates from their cards' marks, workers from the worker projects.
export function deskNames(cards: readonly Pick<Card, "team">[], workers: readonly { workerId: string; worker: string }[]): OwnerNames {
  const marks = new Map<string, TeamMark>();
  for (const c of cards) if (c.team) marks.set(c.team.owner, c.team);
  const workerNames = new Map(workers.map((w) => [`worker:${w.workerId}`, w.worker]));
  return {
    person: (id) => marks.get(id),
    machine: (id) => workerNames.get(id),
  };
}

// ?who=…&on=… read from a URL's query, and written back onto it (an empty value is dropped).
export function readOwnerParams(search: string): { who?: string; on?: string } {
  const q = new URLSearchParams(search);
  return { who: q.get("who") || undefined, on: q.get("on") || undefined };
}

export function withOwnerParams(href: string, filter: { who?: string; on?: string }): string {
  const url = new URL(href);
  for (const key of ["who", "on"] as const) {
    const value = filter[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url.toString();
}
