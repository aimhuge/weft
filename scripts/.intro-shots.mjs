// Temporary: screenshot public/intros/<id>.html at given seek times, driving Chrome over CDP.
// Usage: node scripts/.intro-shots.mjs <id> <t1,t2,...>
// Writes .intro-shots/<id>-<t>.png into the repo root.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocket } from "ws";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9333;
const ROOT = process.cwd();
const OUT = path.join(ROOT, ".intro-shots");

const id = process.argv[2] || "newthread";
const times = (process.argv[3] || "2.5").split(",").map(Number);

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
      if (msg.method) {
        const list = this.handlers.get(msg.method);
        if (list) for (const h of list) h(msg.params, msg.sessionId);
      }
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-intro-"));
  const child = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,InfiniteSessionRestore",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--window-size=1600,900",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no DevTools in 30s")), 30000);
    let buf = "";
    const onChunk = (chunk) => {
      buf += chunk.toString("utf8");
      if (/DevTools listening on/i.test(buf)) { clearTimeout(timer); resolve(); }
    };
    child.stderr.on("data", onChunk);
    child.stdout.on("data", onChunk);
    child.once("exit", (code) => reject(new Error("chrome exited " + code)));
  });

  try {
    const v = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const client = new Cdp(ws);

    const { browserContextId } = await client.send("Target.createBrowserContext");
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => client.send(method, params, sessionId);

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

    for (const t of times) {
      const url = `file://${path.join(ROOT, "public", "intros", id + ".html")}?t=${t}`;
      const navP = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
      await send("Page.navigate", { url });
      await navP;
      await new Promise((r) => setTimeout(r, 400));
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      const out = path.join(OUT, `${id}-${t}.png`);
      fs.writeFileSync(out, Buffer.from(data, "base64"));
      console.log("captured", out);
    }
    ws.close();
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
