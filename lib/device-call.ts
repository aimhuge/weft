// Local Simulator mode's wire format (docs/architecture/manual-qa.md): the call a worker's simulator tool makes to its owner's
// Mac, and what the Mac reads back off the network. Both sides read this, so they can't drift. The Mac treats a call as
// untrusted input: only these tools, only these fields, each the type it must be. `device` is never one of them, because
// the Mac only touches the device its owner picked, and neither is a path, because a path on a worker means nothing here.
import type { ToolResult } from "./browser-shell";

export const DEVICE_TOOLS = ["list_devices", "boot", "install", "launch", "open_url", "ui_tree", "tap", "swipe", "type_text", "press", "screenshot", "logs", "watch"] as const;
export type DeviceTool = (typeof DEVICE_TOOLS)[number];

export const isDeviceTool = (v: unknown): v is DeviceTool => DEVICE_TOOLS.some((t) => t === v);

const SHA_RE = /^[0-9a-f]{64}$/;
const KEYS = ["home", "back", "enter", "lock"];
const DIRECTIONS = ["up", "down", "left", "right"];
const MAX_TEXT = 4_000;
const MAX_ID = 300;

export type BuildKind = "app" | "apk";
export interface BuildRef {
  sha: string;
  kind: BuildKind;
  bytes: number;
}

type Raw = Record<string, unknown>;

const str = (v: unknown, max = MAX_ID) => (typeof v === "string" && v && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function pick(raw: Raw, fields: Record<string, (v: unknown) => unknown>): Raw {
  const out: Raw = {};
  for (const [name, read] of Object.entries(fields)) {
    const value = read(raw[name]);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export function buildRef(raw: unknown): BuildRef | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const sha = typeof p.sha === "string" && SHA_RE.test(p.sha) ? p.sha : undefined;
  const kind = p.kind === "app" || p.kind === "apk" ? p.kind : undefined;
  const bytes = num(p.bytes);
  return sha && kind && bytes !== undefined && bytes > 0 ? { sha, kind, bytes } : null;
}

const FIELDS: Record<Exclude<DeviceTool, "install">, Record<string, (v: unknown) => unknown>> = {
  list_devices: {},
  boot: {},
  launch: { app: str },
  open_url: { url: (v) => str(v, MAX_TEXT) },
  ui_tree: {},
  tap: { element: (v) => str(v, MAX_TEXT), x: num, y: num },
  swipe: { direction: (v) => (DIRECTIONS.includes(v as string) ? v : undefined), from_x: num, from_y: num, to_x: num, to_y: num },
  type_text: { text: (v) => (typeof v === "string" && v.length <= MAX_TEXT ? v : undefined), element: (v) => str(v, MAX_TEXT) },
  press: { key: (v) => (KEYS.includes(v as string) ? v : undefined) },
  screenshot: {},
  logs: { app: str, lines: num, since: (v) => (typeof v === "string" && /^\d{1,4}[smh]$/.test(v) ? v : undefined) },
  watch: {},
};

// A call as the Mac reads it. Throws for a tool off the list or a build that doesn't parse.
export function callArgs(tool: unknown, raw: unknown): { tool: DeviceTool; args: Raw } {
  if (!isDeviceTool(tool)) throw new Error("That tool can't reach this Mac.");
  const given = (raw && typeof raw === "object" ? raw : {}) as Raw;
  if (tool === "install") {
    const build = buildRef(given.build);
    if (!build) throw new Error("That install names no build.");
    return { tool, args: { build } };
  }
  return { tool, args: pick(given, FIELDS[tool]) };
}

// A tool's answer as it travels. Only what a tool result holds, so a result row can't smuggle anything else in.
export function toolResultOf(raw: unknown): ToolResult {
  const p = (raw && typeof raw === "object" ? raw : {}) as { content?: unknown; isError?: unknown };
  const content: ToolResult["content"] = [];
  for (const c of Array.isArray(p.content) ? (p.content as Raw[]) : []) {
    if (c.type === "text" && typeof c.text === "string") content.push({ type: "text", text: c.text });
    else if (c.type === "image" && typeof c.data === "string" && typeof c.mimeType === "string") content.push({ type: "image", data: c.data, mimeType: c.mimeType });
  }
  return { content, ...(p.isError === true ? { isError: true } : {}) };
}
