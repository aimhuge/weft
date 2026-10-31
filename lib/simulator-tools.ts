import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import sharp from "sharp";
import { z } from "zod";
import { attempt, text, type ToolResult } from "./browser-shell";
import { openInPane, savePng } from "./browser-tools";
import { SHOW_DIR } from "./show-dir";
import { boot, bootedDevice, install, launch, listDevices, logs, openUrl, screenshot, type Device } from "./simulator-devices";
import { center, describe, directionSwipe, findElement, KEYS, named, press, swipe, tapAt, typeText, uiTree } from "./simulator-ui";
import { watch, watching, writeFrame } from "./simulator-watch";
import { onWorker } from "./worker-pane";
import { screenOnWorker } from "./worker-screen";

export const SIMULATOR_PROMPT = `When the user asks about a React Native or Expo app (react-native or expo in its package.json), offer the web build first: start \`npx expo start --web\` with mcp__devservers__start and show it in the browser pane at phone size (set_viewport phone). It renders through react-native-web, live and clickable with hot reload, and boots no device, which costs gigabytes of memory. Plain React Native needs react-native-web set up before --web works. Boot a simulator when the change needs native code (push, camera, native modules, native gestures) or for a final check on a real device. To try a mobile app or a site on a phone, drive an iOS simulator or Android emulator with the mcp__simulator__* tools: list_devices, boot, install and launch the app (or open_url for a deep link or a local dev server in mobile Safari or Chrome), then ui_tree to read the screen and tap, type_text or swipe by element. Call watch so the user sees the device live in the browser pane, and screenshot when a step is worth showing. When a tool says Xcode, a runtime, the Android SDK or AXe is missing, tell the user to click Install beside it in Settings → Connectors → Simulators (Weft downloads and sets it up), and ask before installing anything yourself.`;

// The picture a thread sees: tall phone screens shrunk to a height that reads well and costs little.
const SHOT_HEIGHT = 1000;

const deviceArg = z.string().optional().describe("Device id (udid, adb serial, or avd:<name>) or name from list_devices; defaults to the one booted device");

function line(d: Device) {
  return `${d.state === "booted" ? "●" : "○"} ${d.name} · ${d.runtime ?? d.platform} · ${d.state} · ${d.id}`;
}

// After a touch the screen changes; a live view picks the new frame up at once instead of on its next tick.
const refresh = (d: Device) => (watching(d.id) ? writeFrame(d).catch(() => {}) : Promise.resolve());

async function act(device: string | undefined, run: (d: Device) => Promise<string>): Promise<ToolResult> {
  return attempt(async () => {
    const d = await bootedDevice(device);
    const said = await run(d);
    await refresh(d);
    return text(said);
  });
}

async function shot(device: string | undefined, saveTo: string | undefined): Promise<ToolResult> {
  const d = await bootedDevice(device);
  const png = await screenshot(d);
  const meta = await sharp(png).metadata();
  const small = await sharp(png).resize({ height: SHOT_HEIGHT, withoutEnlargement: true }).png().toBuffer();
  const units = d.platform === "ios" ? "points (screen pixels ÷ the device's scale, 3 on most iPhones)" : "screen pixels";
  const content: ToolResult["content"] = [
    { type: "image", data: small.toString("base64"), mimeType: "image/png" },
    { type: "text", text: `${d.name}: ${meta.width}x${meta.height} px screen. Taps by coordinate are in ${units}; tapping by element from ui_tree is safer.` },
  ];
  if (saveTo) content.push({ type: "text", text: `Saved to ${savePng(saveTo, png.toString("base64"))}` });
  return { content };
}

// A fresh server per query, like the browser's: an MCP server instance serves one connection. Only watch needs
// the card, to open its live page in that card's pane.
export function simulatorMcpServer(cardId: () => string | undefined) {
  return createSdkMcpServer({
    name: "simulator",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool("list_devices", "List iOS simulators and Android emulators (running and not), with ids, runtimes and states.", {}, () =>
        attempt(async () => {
          const devices = await listDevices();
          return text(devices.length ? devices.map(line).join("\n") : "No simulators or emulators found. Settings → Connectors → Simulators says what to install.");
        }),
      ),
      tool("boot", "Boot a simulator or emulator and wait until it's ready.", { device: z.string().describe("Device id or name from list_devices") }, ({ device }) =>
        attempt(async () => text(`Booted ${line(await boot(device))}`)),
      ),
      tool(
        "install",
        "Install an app on a booted device: a built .app folder (iOS simulator) or an .apk (Android).",
        { path: z.string().describe("Absolute path of the .app or .apk"), device: deviceArg },
        ({ path, device }) => act(device, async (d) => (await install(d, path), `Installed ${path} on ${d.name}`)),
      ),
      tool(
        "launch",
        "Launch an installed app by its bundle id (iOS, e.g. com.example.app) or package name (Android).",
        { app: z.string(), device: deviceArg },
        ({ app, device }) =>
          act(device, async (d) => {
            const said = await launch(d, app);
            return `Launched ${app} on ${d.name}${said ? `: ${said}` : ""}`;
          }),
      ),
      tool(
        "open_url",
        "Open a URL on the device: a deep link, or a web page in mobile Safari / Chrome. localhost works on both (Android gets the port reversed to the Mac).",
        { url: z.string(), device: deviceArg },
        ({ url, device }) => act(device, async (d) => (await openUrl(d, url), `Opened ${url} on ${d.name}`)),
      ),
      tool("ui_tree", "Read what's on the device's screen: each labelled element with its [index], type, label, #id and frame.", { device: deviceArg }, ({ device }) =>
        attempt(async () => {
          const d = await bootedDevice(device);
          const els = named(await uiTree(d));
          return text(els.length ? els.map(describe).join("\n") : "Nothing labelled on screen (the app may still be loading).");
        }),
      ),
      tool(
        "tap",
        "Tap an element by its [index], #id or label from ui_tree, or tap x,y as a fallback (iOS points, Android pixels).",
        { element: z.string().optional(), x: z.number().optional(), y: z.number().optional(), device: deviceArg },
        ({ element, x, y, device }) =>
          act(device, async (d) => {
            if (element) {
              const el = findElement(await uiTree(d), element);
              const at = center(el);
              await tapAt(d, at.x, at.y);
              return `Tapped ${describe(el)}`;
            }
            if (x === undefined || y === undefined) throw new Error("Give element, or both x and y.");
            await tapAt(d, x, y);
            return `Tapped ${x},${y}`;
          }),
      ),
      tool(
        "swipe",
        "Swipe across the screen by direction (up scrolls content down the page), or from one point to another.",
        {
          direction: z.enum(["up", "down", "left", "right"]).optional(),
          from_x: z.number().optional(),
          from_y: z.number().optional(),
          to_x: z.number().optional(),
          to_y: z.number().optional(),
          device: deviceArg,
        },
        ({ direction, from_x, from_y, to_x, to_y, device }) =>
          act(device, async (d) => {
            if (direction) {
              const move = directionSwipe(await uiTree(d), direction);
              await swipe(d, move.from, move.to);
              return `Swiped ${direction}`;
            }
            if (from_x === undefined || from_y === undefined || to_x === undefined || to_y === undefined) throw new Error("Give direction, or from_x, from_y, to_x and to_y.");
            await swipe(d, { x: from_x, y: from_y }, { x: to_x, y: to_y });
            return `Swiped ${from_x},${from_y} → ${to_x},${to_y}`;
          }),
      ),
      tool(
        "type_text",
        "Type text into the focused field, or tap a field first by its [index], #id or label. iOS takes US keyboard characters only.",
        { text: z.string(), element: z.string().optional(), device: deviceArg },
        ({ text: value, element, device }) =>
          act(device, async (d) => {
            if (element) {
              const at = center(findElement(await uiTree(d), element));
              await tapAt(d, at.x, at.y);
            }
            await typeText(d, value);
            return `Typed ${value.length} characters${element ? ` into ${element}` : ""}`;
          }),
      ),
      tool("press", "Press a hardware key: home, back (Android), enter or lock.", { key: z.enum(KEYS), device: deviceArg }, ({ key, device }) =>
        act(device, async (d) => (await press(d, key), `Pressed ${key}`)),
      ),
      tool(
        "screenshot",
        "Take a screenshot of the device. save_to also writes the full-size PNG (absolute path), so a page you write can show it.",
        { save_to: z.string().optional().describe(`Absolute path to save the PNG at, e.g. ${SHOW_DIR}/app/home.png`), device: deviceArg },
        ({ save_to, device }) => attempt(() => shot(device, save_to)),
      ),
      tool(
        "logs",
        "Recent device logs, newest last: optionally one app's (iOS process name, Android package).",
        { app: z.string().optional(), lines: z.number().optional().describe("How many lines, up to 400 (default 100)"), since: z.string().optional().describe("iOS only: how far back, e.g. 30s, 5m (default 2m)"), device: deviceArg },
        ({ app, lines, since, device }) =>
          attempt(async () => text((await logs(await bootedDevice(device), { app, lines, since })) || "No log lines.")),
      ),
      tool("watch", "Show the device live in the browser pane for 10 minutes (call again to extend): its window captured at 30 fps, where the user can tap and swipe, or a screenshot a second without Screen Recording permission.", { device: deviceArg }, ({ device }) =>
        attempt(async () => {
          const d = await bootedDevice(device);
          if (onWorker()) return text(await screenOnWorker(cardId(), d));
          const url = await watch(d);
          const card = cardId();
          if (!card) return text(`Live view at ${url}; open it with mcp__browser__open_url.`);
          await openInPane(url, card);
          return text(`Watching ${d.name} in the browser pane: ${url}`);
        }),
      ),
    ],
  });
}
