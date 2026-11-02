// The Mac's side of Local Simulator mode (docs/architecture/manual-qa.md). A worker's simulator tool queues a row in
// public.device_calls; the inbox (lib/cloud-inbox.ts) hears it and this runs it on the device its owner picked, then
// writes the answer back for the tool that's waiting. A call is untrusted: it needs a live grant for that card and worker
// (lib/qa-grants.ts), its arguments are re-read (lib/device-call.ts), and the device comes from the grant, never the row.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shell, text, type ToolResult } from "./browser-shell";
import { downloadBuild, sweepBuilds, unpackBuild } from "./device-build";
import { callArgs, type BuildRef, type DeviceTool } from "./device-call";
import { APPROVAL_TOOLS, runApproval } from "./device-call-approvals";
import { deviceId } from "./device-id";
import { globalSingleton } from "./global-singleton";
import { requireGrant, type QaGrant } from "./qa-grants";
import { SECRET_ASK_TOOL } from "./secret-use";
import { recentCrashes } from "./simulator-crashes";
import { bootedDevice, listDevices } from "./simulator-devices";
import { simulatorTools } from "./simulator-tools";
import { SITE } from "./site";
import { VAULT_TOOLS } from "./worker-vault-wire";

const ERROR_MAX = 1_000;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

export interface DeviceCallRow {
  id: string;
  worker_id: string;
  card_id: string;
  tool: string;
  args: unknown;
}

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

async function runTool(card: string, tool: DeviceTool, args: Record<string, unknown>) {
  const found = simulatorTools(() => card).find((t) => t.name === tool);
  if (!found) throw new Error("That tool can't reach this Mac.");
  return (found.handler as Handler)(args, {});
}

// Where a build is, from the route that checks this call is yours (app/api/worker-build). Never a URL off the row.
async function buildUrl(client: SupabaseClient, callId: string, site = SITE): Promise<string> {
  const { data } = await client.auth.getSession();
  const res = await fetch(`${site}/api/worker-build?call=${encodeURIComponent(callId)}`, { headers: { authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  const got = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !got.url) throw new Error(got.error || `Couldn't find the build: HTTP ${res.status}`);
  return got.url;
}

async function install(client: SupabaseClient, row: DeviceCallRow, grant: QaGrant, build: BuildRef) {
  sweepBuilds();
  const file = await downloadBuild(await buildUrl(client, row.id), build);
  const local = await unpackBuild(file, build);
  return runTool(grant.cardId, "install", { path: local, device: grant.device });
}

// This Mac's localhost isn't what a worker's thread means by localhost, and on Android open_url would reverse a port.
function refuseLocal(url: unknown) {
  if (typeof url !== "string" || !URL.canParse(url)) return;
  if (LOCAL.test(new URL(url).hostname)) throw new Error("A worker's thread can't open this Mac's localhost. A bundled build doesn't need it.");
}

// Runs one call and answers what the tool would. Only the device the grant names is listed or touched.
export async function runDeviceCall(client: SupabaseClient, row: DeviceCallRow, now = Date.now()): Promise<ToolResult> {
  const grant = requireGrant(row.card_id, row.worker_id, now);
  const { tool, args } = callArgs(row.tool, row.args);
  if (tool === "install") return install(client, row, grant, args.build as BuildRef);
  if (tool === "open_url") refuseLocal(args.url);
  if (tool === "list_devices") {
    const mine = (await listDevices()).filter((d) => d.id === grant.device || d.name === grant.device);
    return text(mine.map((d) => `${d.state === "booted" ? "●" : "○"} ${d.name} · ${d.runtime ?? d.platform} · ${d.state} · on the user's Mac`).join("\n") || `${grant.name} isn't on this Mac anymore.`);
  }
  const result = await runTool(grant.cardId, tool, { ...args, device: grant.device });
  if (tool !== "logs" || result.isError) return result;
  const crashes = await recentCrashes(await bootedDevice(grant.device), typeof args.app === "string" ? args.app : undefined, now);
  return crashes ? { ...result, content: [...result.content, { type: "text", text: `Crash reports:\n${crashes}` }] } : result;
}

async function finish(client: SupabaseClient, id: string, patch: { status: "done" | "failed"; result?: unknown; error?: string }) {
  const { error } = await client
    .from("device_calls")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn(`Local Simulator: couldn't answer ${id}: ${error.message}`);
}

async function take(client: SupabaseClient, row: DeviceCallRow) {
  const claim = await client.from("device_calls").update({ status: "claimed" }).eq("id", row.id).eq("status", "pending").select("id");
  if (claim.error || !claim.data.length) return;
  try {
    // A worker card's secret ask goes to Electron main, which re-reads the row itself and asks the user with Touch ID
    // (electron/worker-secret.cjs); it answers queued, denied or missing, never a value. A tunnel or relay asks the user
    // with Touch ID too (lib/device-call-approvals.ts); no QA grant is involved in either.
    // A worker card's vault call (list, blanks, set_value, push_to_vercel, a dev server's env) goes to main the same way,
    // by id only (electron/worker-vault.cjs): names in, names or "queued" out, never a value.
    const answer = row.tool === SECRET_ASK_TOOL ? shell("/secrets/worker-ask", { call: row.id }) : VAULT_TOOLS.has(row.tool) ? shell("/secrets/worker-vault", { call: row.id }) : APPROVAL_TOOLS.has(row.tool) ? runApproval(client, row) : runDeviceCall(client, row);
    await finish(client, row.id, { status: "done", result: await answer });
  } catch (err) {
    await finish(client, row.id, { status: "failed", error: (err as Error).message.slice(0, ERROR_MAX) });
  }
}

// A secret ask, a vault call or an approval may wait on a person at this Mac.
const waitsOnPerson = (tool: string) => tool === SECRET_ASK_TOOL || VAULT_TOOLS.has(tool) || APPROVAL_TOOLS.has(tool);

const state = () => globalSingleton("__weftDeviceCalls", () => ({ draining: false, again: false }));

// Oldest first and one at a time, as a thread makes them: a tap must land after the install before it. Kept apart from the
// inbox's own drain, so an install that takes a minute doesn't hold up a reply to a thread here.
export async function drainDeviceCalls(client: SupabaseClient, uid: string) {
  const g = state();
  if (g.draining) {
    g.again = true;
    return;
  }
  g.draining = true;
  const nudged = () => g.again;
  try {
    do {
      g.again = false;
      const { data, error } = await client
        .from("device_calls")
        .select("id, worker_id, card_id, tool, args")
        .eq("target_device", deviceId())
        .eq("owner_user", uid)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(20)
        .overrideTypes<DeviceCallRow[]>();
      // A database without the table yet: nothing to run, and nothing worth saying every 30 s.
      if (error) return;
      // A secret ask or an approval waits on a person at this Mac, so it doesn't hold up the device calls behind it.
      for (const row of data) {
        if (waitsOnPerson(row.tool)) void take(client, row);
        else await take(client, row);
      }
    } while (nudged());
  } finally {
    g.draining = false;
  }
}
