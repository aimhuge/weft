"use client";

// Where the New thread dialog's card goes (docs/architecture/new-card-parity.md), so the desktop and weft.zip draw the
// same NewCardDialog, the way lib/thread-transport.ts lets them draw the same thread. The desktop's is the default: a
// local folder picker, Settings' defaults, plan limits, crons and agents, and its own POST /api/cards (the dialog's
// onCreate). weft.zip's names the places a card can start instead (your synced folders on each Mac or worker), and its
// onCreate turns the dialog's input into a `new_card` command for that machine (webNewCard below).
import { createContext, useContext } from "react";
import { NEW_CARD_MODES, type NewCardForm, type NewCardMode } from "./cloud-commands";
import type { NewCardInput } from "./client-api";
import type { PermissionMode } from "./types";
import type { CloudCardRow } from "./cloud-sync-types";
import type { WebTarget } from "./web-commands";

export interface NewCardTransport {
  // This machine's own server: its folders, Settings' defaults, plan limits, crons and the Agent menu.
  local: boolean;
  // The places a card can start, when the folder isn't picked from this machine's disk.
  places?: WebTarget[];
  // Under the buttons in place of the desktop's status strip.
  note?: string;
  // Plan first, on a worker's place: the worker starts it in plan mode, which a Mac (and so the desktop's ModePicker)
  // doesn't have (lib/worker-commands.ts RUN_MODES).
  plan?: { on: boolean; set: (on: boolean) => void };
  // The mode a place's Mac starts a thread in when none is named (lib/web-start-modes.ts), for the menu to open on.
  startMode?: (key: string) => PermissionMode | undefined;
}

export const localNewCard: NewCardTransport = { local: true };

export const NewCardTransportContext = createContext<NewCardTransport>(localNewCard);

export const useNewCardTransport = () => useContext(NewCardTransportContext);

// A worker's device id is `worker:<id>` (lib/worker-commands.ts workerDevice, which a browser can't import: it seals).
export const isWorkerDevice = (device: string) => device.startsWith("worker:");

// A place as the dialog's `cwd`: the device and the folder, which together name it.
export const placeKey = (place: Pick<WebTarget, "device" | "folder">) => `${place.device}\n${place.folder}`;

export const placeOf = (places: WebTarget[], key: string) => places.find((p) => placeKey(p) === key);

// Whether a place can hold a card in Backlog: a worker's cards start when they're made.
export const canBacklog = (key: string) => !isWorkerDevice(key.split("\n")[0] ?? "");

// The place the dialog opens on: the project chip the board has selected, else the most recently active one.
export function firstPlace(places: WebTarget[], folder: string | null | undefined): string | undefined {
  const place = places.find((p) => p.folder === folder) ?? places[0];
  return place ? placeKey(place) : undefined;
}

const NO_BACKLOG = "A worker has no Backlog yet: its threads start when they're made.";

// The mode a new card from a browser names: plan with Plan first on a worker, else the one picked if the web may name it.
function startMode(picked: NewCardInput["permissionMode"], plan: boolean): NewCardMode | undefined {
  if (plan) return "plan";
  return NEW_CARD_MODES.includes(picked as NewCardMode) ? (picked as NewCardMode) : undefined;
}

// The dialog's input as the `new_card` form for its place, or why it can't go. `plan`: Plan first, kept on a worker only. The agent stays behind: a thread with
// one from the network needs a signed approval (lib/create-widen.ts), so the Mac starts it as the project's default.
// Skip permissions never leaves a browser (NEW_CARD_MODES).
export function webNewCard(input: NewCardInput, places: WebTarget[], plan = false): { target: WebTarget; form: NewCardForm } | string {
  const target = placeOf(places, input.cwd);
  if (!target) return "Pick where it runs first.";
  const worker = isWorkerDevice(target.device);
  if (!input.start && worker) return NO_BACKLOG;
  const mode = startMode(input.permissionMode, plan && worker);
  const form: NewCardForm = {
    prompt: input.prompt,
    backend: input.backend,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(mode ? { permissionMode: mode } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.start ? {} : { backlog: true }),
    ...(input.isolated ? { isolated: true, ...(input.branch ? { branch: input.branch } : {}) } : {}),
  };
  return { target, form };
}

// A card already in the place, whose host lists the project's skills for the "/" typeahead before the new one exists
// (lib/cloud-host-acts.ts listSkills asks the machine that runs a card); undefined when the place has none.
export function skillsCardFor(rows: Pick<CloudCardRow, "card_id" | "owner_device" | "folder" | "deleted">[], key: string): string | undefined {
  return rows.find((r) => !r.deleted && placeKey({ device: r.owner_device, folder: r.folder }) === key)?.card_id;
}

// The place's Mac's published start mode, by place key; undefined for a worker or a Mac that hasn't published one.
export const startModeFor = (modes: Record<string, PermissionMode>) => (key: string): PermissionMode | undefined => modes[key.split("\n")[0] ?? ""];
