// The worker's end of Local Simulator mode's wire: the key-checked database calls, and a build's trip to R2 (app/api/worker-build).
// The PUT goes straight to R2 as a stream: a build doesn't fit through a Vercel function, or in the daemon's memory.
import fs from "node:fs";
import { Readable } from "node:stream";
import type { BuildRef } from "./device-call";
import { SITE } from "./site";
import type { DeviceLink } from "./worker-device";
import type { DeviceAnswer } from "./worker-registry";

interface Calls {
  deviceCall(device: string, cardId: string, tool: string, args: unknown): Promise<string | null>;
  deviceResult(id: string): Promise<DeviceAnswer | null>;
  deviceCancel(id: string): Promise<boolean>;
}

export function deviceLink(reg: Calls, key: string, site = SITE, fetcher: typeof fetch = fetch): DeviceLink {
  return {
    call: (device, cardId, tool, args) => reg.deviceCall(device, cardId, tool, args),
    result: (id) => reg.deviceResult(id),
    cancel: (id) => reg.deviceCancel(id),
    async upload(file: string, build: BuildRef) {
      const res = await fetcher(`${site}/api/worker-build`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ sha: build.sha, bytes: build.bytes }),
      });
      const got = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !got.url) throw new Error(got.error || `Couldn't send the build: HTTP ${res.status}`);
      const put = await fetcher(got.url, {
        method: "PUT",
        headers: { "content-length": String(build.bytes), "content-type": "application/octet-stream" },
        body: Readable.toWeb(fs.createReadStream(file)) as BodyInit,
        duplex: "half",
      } as RequestInit);
      if (!put.ok) throw new Error(`Couldn't send the build: R2 said ${put.status}`);
    },
  };
}
