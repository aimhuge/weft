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
// a project name the Mac resolves among its synced folders (lib/cloud-inbox-cards.ts syncFolderFor).
export function parseMacPath(text: string): { mac: string; folder: string } {
  const rest = text.slice(MAC_SCHEME.length);
  const slash = rest.indexOf("/");
  const tail = slash < 1 ? "" : rest.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  if (!tail) throw new Error(`${text} isn't a Mac project: write mac://<Mac name or id>/<path>.`);
  return { mac: rest.slice(0, slash), folder: tail.includes("/") ? `/${tail}` : tail };
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
