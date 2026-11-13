// The `from` of a pull from another of your Macs, "mac:<device id>/<folder name>": built by the board's menu
// (lib/mac-twins.ts) and read by the server (lib/mac-host-verbs.ts). No server imports, so the board can use it.
export interface MacSource {
  device: string;
  folder: string;
}

const MAC = /^mac:([0-9a-f]{8,64})\/([^/]+)$/;

export const macSource = (device: string, folder: string) => `mac:${device}/${folder}`;

export function parseMacSource(from: string): MacSource | null {
  const m = MAC.exec(from);
  return m ? { device: m[1] as string, folder: m[2] as string } : null;
}
