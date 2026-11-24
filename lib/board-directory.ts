// Names for the weft.zip board's person and machine pickers (lib/board-owners.ts): the people and machines behind the
// cards the visitor can already read. The page reads them on the server with the teams gate's service client, because
// a teammate's devices and workers are only readable by their owner under RLS; it asks only for the ids on rows RLS
// gave the visitor, and hands the client plain names and avatars, never the client itself (docs/architecture/teams.md).
import type { SupabaseClient } from "@supabase/supabase-js";
import { machineName } from "./board-owners";
import type { CloudCardRow } from "./cloud-sync-types";

export interface BoardPerson {
  name: string;
  avatar: string | null;
}

// People by account id, machines by the owner_device their cards carry (a Mac's device id, or `worker:<id>`).
export interface BoardDirectory {
  people: Record<string, BoardPerson>;
  machines: Record<string, string>;
}

export const EMPTY_DIRECTORY: BoardDirectory = { people: {}, machines: {} };

type Rows = readonly Pick<CloudCardRow, "owner_user" | "owner_device">[];

interface ProfileRow {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

// A person's name as the team pages show it: their display name, their name, or their email's local part.
export const personName = (p: ProfileRow) => p.display_name?.trim() || p.name?.trim() || p.email?.split("@")[0] || "A teammate";

export async function boardDirectory(service: SupabaseClient, rows: Rows): Promise<BoardDirectory> {
  const users = [...new Set(rows.map((r) => r.owner_user).filter((u): u is string => Boolean(u)))];
  const devices = [...new Set(rows.map((r) => r.owner_device).filter(Boolean))];
  const macs = devices.filter((d) => !d.startsWith("worker:"));
  const workers = devices.filter((d) => d.startsWith("worker:")).map((d) => d.slice("worker:".length));
  const [people, machines] = await Promise.all([readPeople(service, users), readMachines(service, macs, workers)]);
  return { people, machines };
}

async function readPeople(service: SupabaseClient, ids: string[]): Promise<BoardDirectory["people"]> {
  if (!ids.length) return {};
  const { data } = await service.from("profiles").select("id, name, display_name, email, avatar_url").in("id", ids);
  const out: BoardDirectory["people"] = {};
  for (const p of (data ?? []) as ProfileRow[]) out[p.id] = { name: personName(p), avatar: p.avatar_url };
  return out;
}

// A Mac's name: the one Weft lists it by in Settings → Devices (its cloud_workers row, kind desktop), else its devices
// row's ("Weft on MacBook-Air.local" cut to "MacBook-Air"). A worker's is its cloud_workers row's.
async function readMachines(service: SupabaseClient, macs: string[], workers: string[]): Promise<BoardDirectory["machines"]> {
  const [registered, listed, headless] = await Promise.all([
    macs.length ? service.from("devices").select("host_device, name").eq("kind", "desktop").in("host_device", macs) : null,
    macs.length ? service.from("cloud_workers").select("device, name").eq("kind", "desktop").in("device", macs) : null,
    workers.length ? service.from("cloud_workers").select("id, name").in("id", workers) : null,
  ]);
  type Named = { name: string | null };
  // Later reads win: a Mac's cloud_workers name over its devices one.
  return {
    ...namesBy((registered?.data ?? []) as (Named & { host_device: string })[], (d) => d.host_device),
    ...namesBy((listed?.data ?? []) as (Named & { device: string })[], (w) => w.device),
    ...namesBy((headless?.data ?? []) as (Named & { id: string })[], (w) => `worker:${w.id}`),
  };
}

function namesBy<T extends { name: string | null }>(rows: T[], key: (row: T) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const name = machineName(row.name);
    if (name) out[key(row)] = name;
  }
  return out;
}
