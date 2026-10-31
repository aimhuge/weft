// What's on a device's screen, as a flat list of elements a thread can name, and the touches that act on them.
// iOS reads the accessibility tree through AXe (`axe describe-ui`) and taps in points; Android dumps the view
// tree with uiautomator and taps in pixels. Either way an element's frame is in the units its taps take.
import type { Device } from "./simulator-devices";
import { run, runText, shellQuote } from "./simulator-exec";

export type Frame = { x: number; y: number; width: number; height: number };
export type Element = { index: number; type: string; label: string; id: string; value: string; frame: Frame };

type AxNode = {
  AXLabel?: string | null;
  AXUniqueId?: string | null;
  AXValue?: string | null;
  type?: string;
  role?: string;
  frame?: Partial<Frame>;
  children?: AxNode[];
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// AXe prints the tree as JSON: an array of root nodes (or one), each with its children.
export function parseAxTree(json: string): Element[] {
  const parsed = JSON.parse(json) as AxNode | AxNode[];
  const out: Element[] = [];
  const walk = (node: AxNode) => {
    const f = node.frame ?? {};
    out.push({
      index: out.length,
      type: str(node.type) || str(node.role).replace(/^AX/, ""),
      label: str(node.AXLabel),
      id: str(node.AXUniqueId),
      value: str(node.AXValue),
      frame: { x: num(f.x), y: num(f.y), width: num(f.width), height: num(f.height) },
    });
    node.children?.forEach(walk);
  };
  (Array.isArray(parsed) ? parsed : [parsed]).forEach(walk);
  return out;
}

const attr = (node: string, name: string) => {
  const raw = new RegExp(`\\s${name}="([^"]*)"`).exec(node)?.[1] ?? "";
  return raw.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
};

// uiautomator's XML: one <node> per view, with bounds="[x1,y1][x2,y2]". The label is its text, else its
// content description; the id drops the package ("com.app:id/login" → "login").
export function parseUiautomator(xml: string): Element[] {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([node], index) => {
    const [x1, y1, x2, y2] = (/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(node, "bounds")) ?? []).slice(1).map(Number);
    return {
      index,
      type: attr(node, "class").replace(/^.*\./, ""),
      label: attr(node, "text") || attr(node, "content-desc"),
      id: attr(node, "resource-id").replace(/^.*\//, ""),
      value: "",
      frame: { x: x1 || 0, y: y1 || 0, width: (x2 || 0) - (x1 || 0), height: (y2 || 0) - (y1 || 0) },
    };
  });
}

export async function uiTree(d: Device): Promise<Element[]> {
  if (d.platform === "ios") return parseAxTree(await runText("axe", ["describe-ui", "--udid", d.id]));
  // Dumping to /dev/tty puts the XML on stdout with no file left on the device.
  return parseUiautomator(await runText("adb", ["-s", d.id, "exec-out", "uiautomator", "dump", "/dev/tty"]));
}

// The elements worth naming: anything labelled, identified or holding a value, with a size on screen.
export const named = (els: Element[]) => els.filter((e) => (e.label || e.id || e.value) && e.frame.width > 0 && e.frame.height > 0);

const round = (n: number) => Math.round(n);

export function describe(e: Element) {
  const parts = [`[${e.index}]`, e.type || "Element"];
  if (e.label) parts.push(JSON.stringify(e.label));
  if (e.id) parts.push(`#${e.id}`);
  if (e.value && e.value !== e.label) parts.push(`= ${JSON.stringify(e.value)}`);
  const { x, y, width, height } = e.frame;
  parts.push(`(${round(x)},${round(y)} ${round(width)}x${round(height)})`);
  return parts.join(" ");
}

// An element by its [index] from the last read, its id, its exact label, then a label that contains the words.
export function findElement(els: Element[], query: string): Element {
  const q = query.trim();
  const lower = q.toLowerCase();
  const index = /^\[?(\d+)\]?$/.exec(q);
  const list = named(els);
  const found =
    (index ? els.find((e) => e.index === Number(index[1])) : undefined) ??
    list.find((e) => e.id === q) ??
    list.find((e) => e.label === q) ??
    list.find((e) => e.label.toLowerCase() === lower || e.id.toLowerCase() === lower) ??
    list.find((e) => e.label.toLowerCase().includes(lower));
  if (!found) throw new Error(`Nothing on screen matches "${query}". Read the screen with mcp__simulator__ui_tree.`);
  return found;
}

export const center = ({ frame: f }: Element) => ({ x: round(f.x + f.width / 2), y: round(f.y + f.height / 2) });

export async function tapAt(d: Device, x: number, y: number) {
  if (d.platform === "ios") await run("axe", ["tap", "-x", String(x), "-y", String(y), "--udid", d.id]);
  else await run("adb", ["-s", d.id, "shell", "input", "tap", String(round(x)), String(round(y))]);
}

export type Point = { x: number; y: number };

export async function swipe(d: Device, from: Point, to: Point, ms = 300) {
  if (d.platform === "ios") {
    const coords = ["--start-x", from.x, "--start-y", from.y, "--end-x", to.x, "--end-y", to.y].map(String);
    await run("axe", ["swipe", ...coords, "--duration", String(ms / 1000), "--udid", d.id]);
  } else {
    await run("adb", ["-s", d.id, "shell", "input", "swipe", ...[from.x, from.y, to.x, to.y].map((n) => String(round(n))), String(ms)]);
  }
}

// The tree's biggest frame: the window, so the screen's size in tap units. All zeros for an empty tree.
export const largestFrame = (els: Element[]): Frame =>
  els.reduce((a, b) => (b.frame.width * b.frame.height > a.width * a.height ? b.frame : a), { x: 0, y: 0, width: 0, height: 0 });

// A swipe across the middle of the screen, sized from the tree's biggest frame (the window).
export function directionSwipe(els: Element[], direction: "up" | "down" | "left" | "right"): { from: Point; to: Point } {
  const screen = largestFrame(els);
  if (!screen.width || !screen.height) throw new Error("Couldn't tell the screen's size from its UI tree; swipe by coordinates instead.");
  const cx = screen.x + screen.width / 2;
  const cy = screen.y + screen.height / 2;
  const dx = screen.width * 0.3;
  const dy = screen.height * 0.3;
  const moves = { up: [0, dy, 0, -dy], down: [0, -dy, 0, dy], left: [dx, 0, -dx, 0], right: [-dx, 0, dx, 0] } as const;
  const [fx, fy, tx, ty] = moves[direction];
  return { from: { x: round(cx + fx), y: round(cy + fy) }, to: { x: round(cx + tx), y: round(cy + ty) } };
}

export async function typeText(d: Device, text: string) {
  if (d.platform === "ios") {
    await run("axe", ["type", text, "--udid", d.id]);
    return;
  }
  // input text takes %s for a space, and the device's shell parses the rest.
  await run("adb", ["-s", d.id, "shell", "input", "text", shellQuote(text.replace(/%/g, "\\%").replace(/ /g, "%s"))]);
}

export const KEYS = ["home", "back", "enter", "lock"] as const;
export type Key = (typeof KEYS)[number];
// iOS has no back button; Android's keyevent codes.
const ANDROID_KEYS: Record<Key, string> = { home: "3", back: "4", enter: "66", lock: "26" };

export async function press(d: Device, key: Key) {
  if (d.platform === "android") {
    await run("adb", ["-s", d.id, "shell", "input", "keyevent", ANDROID_KEYS[key]]);
    return;
  }
  if (key === "back") throw new Error("iOS has no back button; tap the screen's own Back control instead.");
  // HID usage 40 is Return.
  await run("axe", key === "enter" ? ["key", "40", "--udid", d.id] : ["button", key, "--udid", d.id]);
}
