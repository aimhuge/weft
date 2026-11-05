// A worker's side of Local Simulator mode (docs/architecture/manual-qa.md). A card with qaDevice set sends each simulator tool call
// to its owner's Mac and waits for the answer, so the agent sees an ordinary tool result. `install` packs the path into a
// build first, since a path here means nothing there. When the Mac isn't there the call runs on this box's own device and
// says so. When the Mac refuses (no approval, 8 hours up) the agent reads that: it isn't an outage to route around.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { text, type ToolResult } from "./browser-shell";
import { savePng } from "./browser-tools";
import { MAX_BUILD_BYTES } from "./device-limits";
import { isDeviceTool, toolResultOf, type BuildRef } from "./device-call";
import { getCard } from "./store";
import type { DeviceAnswer } from "./worker-registry";

const exec = promisify(execFile);

const CLAIM_MS = 20_000;
const ANSWER_MS = 90_000;
const INSTALL_MS = 6 * 60_000;
const POLL_MS = 250;

const AWAY = "The user's Mac didn't answer (asleep, or Weft is closed), so this ran on the worker's own device instead. That device may not have the app: install it here to carry on. The next call tries the Mac again.";

export interface DeviceLink {
  call(device: string, cardId: string, tool: string, args: unknown): Promise<string | null>;
  result(id: string): Promise<DeviceAnswer | null>;
  cancel(id: string): Promise<boolean>;
  // Sends a packed build to R2, through the key-checked route.
  upload(file: string, build: BuildRef): Promise<void>;
}

let link: DeviceLink | null = null;

// scripts/weft-worker.ts.
export function setDeviceLink(next: DeviceLink | null) {
  link = next;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

class MacAway extends Error {}

// A .app is a folder, so it travels zipped with its links intact; an .apk is one file already.
export async function packBuild(target: string, dir = os.tmpdir()): Promise<{ file: string; build: BuildRef; temp: boolean }> {
  const place = path.resolve(target);
  const app = place.replace(/\/$/, "").endsWith(".app");
  if (!app && !place.endsWith(".apk")) throw new Error("Give install a built .app folder or an .apk.");
  if (!fs.existsSync(place)) throw new Error(`${place} isn't there. Build it first.`);
  let file = place;
  if (app) {
    file = path.join(dir, `weft-qa-${process.pid}-${Date.now()}.zip`);
    if (process.platform === "darwin") await exec("ditto", ["-c", "-k", "--keepParent", place, file]);
    else await exec("zip", ["-qry", file, path.basename(place)], { cwd: path.dirname(place) });
  }
  const bytes = fs.statSync(/*turbopackIgnore: true*/ file).size;
  if (bytes > MAX_BUILD_BYTES) {
    if (app) fs.rmSync(file, { force: true });
    throw new Error(`That build is ${Math.round(bytes / 1048576)} MB and the limit is 500 MB. On Android, build one ABI (reactNativeArchitectures=arm64-v8a).`);
  }
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(/*turbopackIgnore: true*/ file), hash);
  return { file, build: { sha: hash.digest("hex"), kind: app ? "app" : "apk", bytes }, temp: app };
}

async function argsFor(tool: string, args: Record<string, unknown>, to: DeviceLink): Promise<Record<string, unknown>> {
  if (tool !== "install") return args;
  const { file, build, temp } = await packBuild(String(args.path));
  try {
    await to.upload(file, build);
  } finally {
    if (temp) fs.rmSync(file, { force: true });
  }
  return { build };
}

async function await_(to: DeviceLink, id: string, tool: string, wait: (ms: number) => Promise<unknown>, now: () => number): Promise<ToolResult> {
  const start = now();
  const budget = tool === "install" ? INSTALL_MS : ANSWER_MS;
  for (;;) {
    const answer = await to.result(id);
    if (!answer) throw new MacAway();
    if (answer.status === "done") return toolResultOf(answer.result);
    if (answer.status === "failed") return text(answer.error || "The Mac couldn't run that.", true);
    if (answer.status === "pending" && now() - start > CLAIM_MS && (await to.cancel(id))) throw new MacAway();
    if (now() - start > budget) return text("The Mac took this call and hasn't answered. It may have run: check the screen before trying again.", true);
    await wait(POLL_MS);
  }
}

// The tool's answer, however it was reached. `local` is the same call on this box.
export async function deviceRoute(cardId: string | undefined, tool: string, args: Record<string, unknown>, local: () => Promise<ToolResult>, wait: (ms: number) => Promise<unknown> = sleep, now: () => number = Date.now): Promise<ToolResult> {
  const device = cardId ? getCard(cardId)?.qaDevice : undefined;
  if (!cardId || !device || !link || !isDeviceTool(tool)) return local();
  const to = link;
  try {
    const id = await to.call(device, cardId, tool, await argsFor(tool, withoutSave(args), to));
    if (!id) throw new MacAway();
    return saved(await await_(to, id, tool, wait, now), args.save_to);
  } catch (err) {
    if (!(err instanceof MacAway)) return text((err as Error).message, true);
    const result = await local();
    return { ...result, content: [{ type: "text", text: AWAY }, ...result.content] };
  }
}

function withoutSave(args: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(args).filter(([name]) => name !== "save_to"));
}

// save_to is a path on this box, so it's written here from the picture that came back.
function saved(result: ToolResult, saveTo: unknown): ToolResult {
  const image = result.content.find((c) => c.type === "image");
  if (typeof saveTo !== "string" || !image) return result;
  return { ...result, content: [...result.content, { type: "text", text: `Saved to ${savePng(saveTo, image.data)} at the size that came back from the Mac.` }] };
}
