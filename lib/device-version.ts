// Which Weft version a device runs, from the build string it publishes ("0.7.0+abc1234", cloud_workers.build: a worker's
// from worker_set_build, a Mac's from desktop_set_build). Pure: Settings → Devices (components/DevicesSettings.tsx) and
// the admin Users page (lib/users-sheet.ts) both format it here.

export interface Build {
  version: string;
  commit: string | null;
}

// One device of an account, as admin_device_versions returns it.
export interface DeviceBuild {
  kind: string;
  name: string;
  build: string | null;
  channel: string | null;
}

export function parseBuild(build: string | null | undefined): Build | null {
  const m = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+([0-9a-f]{4,40})(?:-dirty)?)?$/.exec((build ?? "").trim());
  return m ? { version: m[1] as string, commit: m[2]?.slice(0, 7) ?? null } : null;
}

const splitPre = (v: string): [string, string] => (v.includes("-") ? [v.slice(0, v.indexOf("-")), v.slice(v.indexOf("-") + 1)] : [v, ""]);

// By the version's numbers, a prerelease before its release: negative when a is older.
export function compareVersions(a: string, b: string): number {
  const [an, ap] = splitPre(a);
  const [bn, bp] = splitPre(b);
  const x = an.split(".").map(Number);
  const y = bn.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  if (ap === bp) return 0;
  if (!ap) return 1;
  if (!bp) return -1;
  return ap < bp ? -1 : 1;
}

// The newest version among these builds, or null when none parses.
export function newestVersion(builds: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const b of builds) {
    const v = parseBuild(b)?.version;
    if (v && (best === null || compareVersions(v, best) > 0)) best = v;
  }
  return best;
}

// "0.7.0 (abc1234)", with "older" in the brackets for a device behind the newest version seen across your devices.
// Null when the device reports nothing (a phone, a browser, a Mac on an older Weft).
export function versionText(build: string | null | undefined, newest: string | null): string | null {
  const b = parseBuild(build);
  if (!b) return null;
  const older = newest !== null && compareVersions(b.version, newest) < 0;
  const inner = [b.commit, older ? "older" : null].filter(Boolean).join(", ");
  return inner ? `${b.version} (${inner})` : b.version;
}

// Every account's versions: the builds of each of its devices, one entry per device that reports.
export function versionsOf(devices: DeviceBuild[]): string[] {
  return devices.flatMap((d) => {
    const b = parseBuild(d.build);
    return b ? [`${d.kind === "mac" ? "Mac" : "Worker"} ${b.version}${b.commit ? ` (${b.commit})` : ""}`] : [];
  });
}

export interface VersionCount {
  version: string;
  channel: string;
  users: number;
  devices: number;
}

// The distribution across all accounts: devices and distinct accounts per version and channel (a worker, which has no
// channel, counts as "worker"). Newest version first.
export function versionCounts(rows: { id: string; devices: DeviceBuild[] }[]): VersionCount[] {
  const seen = new Map<string, VersionCount & { ids: Set<string> }>();
  for (const r of rows)
    for (const d of r.devices) {
      const b = parseBuild(d.build);
      if (!b) continue;
      const channel = d.channel ?? (d.kind === "worker" ? "worker" : "release");
      const key = `${b.version} ${channel}`;
      const c = seen.get(key) ?? { version: b.version, channel, users: 0, devices: 0, ids: new Set<string>() };
      c.devices += 1;
      c.ids.add(r.id);
      c.users = c.ids.size;
      seen.set(key, c);
    }
  return [...seen.values()]
    .map((c) => ({ version: c.version, channel: c.channel, users: c.users, devices: c.devices }))
    .sort((a, b) => compareVersions(b.version, a.version) || a.channel.localeCompare(b.channel));
}

export const countsText = (counts: VersionCount[]): string => counts.map((c) => `${c.version} ${c.channel} ×${c.devices}`).join(" · ");
