// Calls the live infrastructure route the report uses, the way the browser pane does.
//
//   pnpm infra:probe
//
// It answers: does GET /api/infra/live give the report a usable snapshot, with the numbers the
// page's data-live hooks expect? The secret key comes from the environment (the dev server gets
// it from the vault), and the personal access token is what the egress read needs — without it
// the route says so rather than failing.
//
// The probe talks to the running server over HTTP, exactly as the report page does, so it proves
// the real thing rather than the route in isolation. The launch token comes from the same file
// Electron main writes it to (lib/shell-token.ts) and is never printed.

import { shellToken } from "../lib/shell-token";

const PORT = Number(process.env.WEFT_PORT ?? 1024);
const BASE = `http://127.0.0.1:${PORT}`;
const headers: Record<string, string> = { host: `127.0.0.1:${PORT}` };
const token = shellToken();
if (token) headers["x-weft-token"] = token;

interface Snapshot {
  at: string;
  notes: string[];
  live: Record<string, number | string | null> | null;
  egress: Record<string, unknown> | null;
  providers: { name: string; state: string }[];
  quotas: { resource: string; now: string; free: string; pro: string; fill: number | null }[];
}

const res = await fetch(`${BASE}/api/infra/live`, { headers });
console.log("status:", res.status);
if (!res.ok) {
  console.log("denied:", await res.text());
  console.log(`Is Weft running? Start it with \`pnpm desktop\` (the app serves on 127.0.0.1:${PORT}).`);
  process.exit(1);
}
const body = (await res.json()) as Snapshot;

console.log("at:", body.at);
console.log("notes:", body.notes);
console.log("live?.database_bytes:", body.live?.database_bytes);
console.log("live?.storage_bytes:", body.live?.storage_bytes);
console.log("live?.storage_objects:", body.live?.storage_objects);
console.log("live?.auth_users:", body.live?.auth_users);
console.log("egress:", body.egress);
console.log("providers:", body.providers.map((p) => `${p.name}=${p.state}`).join(", "));
console.log("quotas:");
for (const q of body.quotas) console.log(`  ${q.resource}: now=${q.now} free=${q.free} pro=${q.pro} fill=${q.fill}`);
