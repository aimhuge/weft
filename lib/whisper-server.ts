import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { globalSingleton } from "./global-singleton";

// Advanced dictation: one whisper-server with the model held in memory, on 127.0.0.1 only, so a
// recording skips the model load a fresh whisper-cli pays every time. It starts on the first use,
// and stops after IDLE_MS without a recording, so the ~1-2 GB it holds is only held while you dictate.

export const IDLE_MS = 5 * 60_000;
const READY_MS = 60_000;

interface Server {
  child: ChildProcess;
  port: number;
  model: string;
  ready: Promise<void>;
  idle?: ReturnType<typeof setTimeout>;
}

const s = globalSingleton("weftWhisperServer", () => {
  // Never leave a model loaded behind a Weft that quit.
  process.once("exit", () => stopServer());
  return { server: null as Server | null, starting: null as { model: string; promise: Promise<Server> } | null };
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

// Polls until the server answers, or fails if it exits or takes too long.
async function waitReady(child: ChildProcess, port: number) {
  const until = Date.now() + READY_MS;
  const seen = { exited: false };
  // A spawn that fails (no binary) emits "error" and never "exit".
  child.once("exit", () => (seen.exited = true));
  child.once("error", () => (seen.exited = true));
  while (Date.now() < until) {
    if (seen.exited) throw new Error("whisper-server stopped while starting.");
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("whisper-server took too long to start.");
}

function armIdle(server: Server) {
  clearTimeout(server.idle);
  server.idle = setTimeout(() => stopServer(), IDLE_MS);
  server.idle.unref();
}

async function start(bin: string, model: string): Promise<Server> {
  const port = await freePort();
  const threads = String(Math.max(2, Math.min(8, os.availableParallelism() - 1)));
  const child = spawn(bin, ["-m", model, "--host", "127.0.0.1", "--port", String(port), "-t", threads], { stdio: "ignore" });
  const server: Server = { child, port, model, ready: waitReady(child, port) };
  const forget = () => {
    if (s.server === server) s.server = null;
  };
  child.once("exit", forget);
  child.once("error", forget);
  s.server = server;
  armIdle(server);
  try {
    await server.ready;
  } catch (err) {
    stopServer();
    throw err;
  }
  return server;
}

// The running server for this model, started if it isn't. Calls made while it starts share the start.
export function warmServer(bin: string, model: string): Promise<Server> {
  const running = s.server;
  if (running && running.model === model && running.child.exitCode === null) {
    armIdle(running);
    return running.ready.then(() => running);
  }
  if (s.starting?.model === model) return s.starting.promise;
  stopServer();
  const promise = start(bin, model).finally(() => {
    if (s.starting?.promise === promise) s.starting = null;
  });
  s.starting = { model, promise };
  return promise;
}

export function stopServer() {
  const server = s.server;
  if (!server) return;
  s.server = null;
  clearTimeout(server.idle);
  server.child.kill();
}

export function serverRunning(): boolean {
  return Boolean(s.server && s.server.child.exitCode === null);
}

// Transcribes a 16 kHz mono WAV. No timestamps: with a shortened audio window, timestamped decoding
// makes whisper repeat itself.
export async function serverTranscribe(bin: string, model: string, wav: string, opts: { language: string; audioCtx: number; prompt: string }) {
  const server = await warmServer(bin, model);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(fs.readFileSync(wav))], { type: "audio/wav" }), "audio.wav");
  form.set("response_format", "text");
  form.set("language", opts.language);
  form.set("no_timestamps", "true");
  form.set("audio_ctx", String(opts.audioCtx));
  if (opts.prompt) form.set("prompt", opts.prompt);
  const res = await fetch(`http://127.0.0.1:${server.port}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`whisper-server answered ${res.status}.`);
  armIdle(server);
  return res.text();
}
