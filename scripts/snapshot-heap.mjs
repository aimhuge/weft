// Takes a V8 heap snapshot of a running process through its inspector and writes it to ~/.weft/show/.
//
// The OOM hunt (2026-10-22): six `node::OOMErrorHandler` SIGABRTs between Oct 16 and Oct 18, two of
// them dying inside `Factory::NewCallSiteInfo` / `CaptureSimpleStackTrace` — v8 allocating call-site
// records for `Error` objects. That points at an error-creation loop rather than a slow leak, but the
// crash reports only carry the C++ side. This gets the JS side: two snapshots a few minutes apart,
// diffed by constructor, say whether `Error` and friends are actually climbing.
//
// Usage:
//   node scripts/snapshot-heap.mjs [label]
//
// Needs a process started with an inspector open. For Weft's own dev server:
//   NODE_OPTIONS='--inspect=0.0.0.0:9229' pnpm desktop
// (electron/server.cjs passes NODE_OPTIONS through to the `next dev` child, so no code change is needed.)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.INSPECT_PORT) || 9229;
const OUT_DIR = path.join(os.homedir(), ".weft", "show", "heap");
const label = process.argv[2] || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`inspector on ${PORT} answered ${res.status}`);
  return res.json();
}

// Chrome DevTools Protocol over the target's webSocketDebuggerUrl.
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else entry.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // A snapshot of a multi-GB heap can take minutes; don't let the socket time out first.
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out after 10 min`));
      }, 10 * 60_000).unref?.();
    });
  }
}

async function snapshot(target, file) {
  console.log(`connecting to ${target.title || target.id}…`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket refused")), { once: true });
  });
  const cdp = new Cdp(ws);
  console.log("requesting HeapProfiler.takeHeapSnapshot… this takes a minute or two");

  // One listener: collect the snapshot's chunks as they stream back, and show progress.
  const chunks = [];
  const rawHandler = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(msg.params.chunk);
    else if (msg.method === "HeapProfiler.reportProgress") {
      process.stderr.write(`\r  ${msg.params.done} / ${msg.params.total}   `);
    }
  };
  ws.addEventListener("message", rawHandler);
  const t0 = Date.now();
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: true, captureNumericValue: false });
  ws.removeEventListener("message", rawHandler);
  ws.close();
  process.stderr.write("\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, chunks.join(""));
  const mb = (fs.statSync(file).size / 1e6).toFixed(1);
  console.log(`wrote ${file} (${mb} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return file;
}

const list = await targets().catch((err) => {
  console.error(`no inspector on 127.0.0.1:${PORT} — ${err.message}`);
  console.error("start the process with NODE_OPTIONS='--inspect=0.0.0.0:9229' and retry.");
  process.exit(1);
});

// Prefer a Node target (the dev server); a browser/electron renderer would be a different heap.
const node = list.find((t) => t.title === "node" || /node/i.test(t.title));
const target = node || list[0];
if (!node) console.warn(`no node target found; falling back to "${target?.title}" — that may not be the dev server`);

await snapshot(target, path.join(OUT_DIR, `heap-${label}.heapsnapshot`));
console.log(`\ntake a second one a few minutes later with a different label, then diff:`);
console.log(`  node scripts/snapshot-heap.mjs later`);
console.log(`\nboth files are in ${OUT_DIR}`);