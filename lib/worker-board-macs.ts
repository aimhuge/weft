// The user's Macs as a thread on a Weft Worker names them (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// Two Macs can hold the same path (/Users/me/dev/weft on both), so a folder alone can't say which one a card goes to.
// mac://<Mac>/<path> does, beside worker://<id>/<name>: the Mac by the name it beats with (lib/desktop-worker.ts, its
// host name, already in cloud_workers for Settings → Sync → Workers) or by its device id. worker_board_macs returns them.

export const MAC_SCHEME = "mac://";

// One of the owner's Macs: its device id (cloud_cards.owner_device) and the name it shows in Settings → Sync → Workers.
export interface MacRow {
  device: string;
  name: string;
}

// One Mac's projects as worker_mac_projects returns them (lib/mac-projects.ts writes them): the folders Sync is on for,
// absolute, and its home, for a ~ path.
export interface MacProjectsRow {
  device: string;
  home: string;
  folders: string[];
}

// How much of a device id stands in for a Mac whose name another of the owner's Macs shares, or that has none.
export const MAC_ID_SHOWN = 12;
const MAC_ID_MIN = 8;

export const isMacPath = (text: string) => text.toLowerCase().startsWith(MAC_SCHEME);

const usable = (name: string | undefined) => Boolean(name && !name.includes("/"));

// The label each Mac goes by in a mac:// path: its name when it's the only one of the owner's Macs with that name
// (case aside), else the start of its id. Covers the Macs with cards that worker_board_macs didn't return, too.
export function macLabels(macs: MacRow[], devices: string[]): Map<string, string> {
  const names = new Map(macs.map((m) => [m.device, m.name.trim()]));
  const count = new Map<string, number>();
  for (const name of names.values()) count.set(name.toLowerCase(), (count.get(name.toLowerCase()) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const device of new Set([...names.keys(), ...devices])) {
    const name = names.get(device);
    labels.set(device, name && usable(name) && count.get(name.toLowerCase()) === 1 ? name : device.slice(0, MAC_ID_SHOWN));
  }
  return labels;
}

// A Mac project's address: mac://<label>/Users/me/app, or mac://<label>/app for a project name.
export const macPath = (label: string, folder: string) => `${MAC_SCHEME}${label}/${folder.replace(/^\/+/, "")}`;

// The Mac and folder a mac:// path names: what comes after the Mac is an absolute path when it has a slash in it, else
// a project name the Mac resolves among its synced folders (lib/cloud-inbox-cards.ts syncFolderFor); ~/<path> stays as
// written for expandOnMac.
export function parseMacPath(text: string): { mac: string; folder: string } {
  const rest = text.slice(MAC_SCHEME.length);
  const slash = rest.indexOf("/");
  const tail = slash < 1 ? "" : rest.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  if (!tail) throw new Error(`${text} isn't a Mac project: write mac://<Mac name or id>/<path>.`);
  return { mac: rest.slice(0, slash), folder: isTilde(tail) || !tail.includes("/") ? tail : `/${tail}` };
}

const choices = (labels: Map<string, string>) => [...labels.values()].join(", ") || "none with cards or online yet";

// The device id a mac:// Mac names: its whole id, the first 8 or more characters of it, or its name or label (case
// aside). One Mac or an error that lists them.
export function findMac(key: string, labels: Map<string, string>, macs: MacRow[]): string {
  const want = key.toLowerCase();
  const names = new Map(macs.map((m) => [m.device, m.name.trim().toLowerCase()]));
  const hits = [...labels.keys()].filter(
    (d) => d === key || (want.length >= MAC_ID_MIN && d.startsWith(want)) || names.get(d) === want || (labels.get(d) as string).toLowerCase() === want,
  );
  if (hits.length === 1) return hits[0] as string;
  if (hits.length > 1) throw new Error(`“${key}” is more than one of your Macs: pass one by its id instead (${hits.map((d) => d.slice(0, MAC_ID_SHOWN)).join(", ")}).`);
  throw new Error(`No Mac “${key}” on your board. Your Macs: ${choices(labels)}.`);
}

// One Mac that re-paired (or reinstalled) is two device ids holding the same path, the old one's cards still synced.
// Among Macs that share a path it's one Mac when only one of them is still a live Mac of the owner's (worker_board_macs
// leaves out the revoked), or when the live ones share a name; the one seen last wins (worker_board_macs orders them by
// last seen). Null when they're really different Macs, or none is known to be live.
export function sameMac(devices: string[], macs: MacRow[]): string | null {
  const live = macs.filter((m) => devices.includes(m.device));
  if (!live.length) return null;
  const names = new Set(live.map((m) => m.name.trim().toLowerCase()));
  return names.size === 1 ? (live[0] as MacRow).device : null;
}

export const isTilde = (text: string) => text === "~" || text.startsWith("~/");

// The home folder a Mac's path sits in: /Users/<you> (or /home/<you>), or null.
export const homeOf = (folder: string) => /^\/(?:Users|home)\/[^/]+/.exec(folder)?.[0] ?? null;

// A ~ path as a Mac holds it: ~ is that Mac's home, the one its cards' folders sit in. Null when they show none or two.
export function expandOnMac(text: string, folders: string[]): string | null {
  const homes = new Set(folders.map(homeOf).filter((h): h is string => h !== null));
  return homes.size === 1 ? `${[...homes][0] as string}${text.slice(1)}`.replace(/\/+$/, "") : null;
}
