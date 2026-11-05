// What this Mac last set as a Weft Worker's Goose provider and endpoint (docs/architecture/weft-worker.md#goose-on-a-worker).
// electron/widen-sign.cjs records it once Touch ID has passed and main has signed the `settings.put` that carries it;
// electron/worker-goose-key.cjs sends a worker's Goose turn this Mac's provider key only for exactly that provider and
// endpoint, so a worker (or anyone holding its keys) can't point the key somewhere the user never approved here.
// Kept in vault/worker-goose.json, sealed with safeStorage like main's other worker records: a file that won't open
// reads as nothing set, so every key ask is refused until the settings are saved again.
const fs = require("node:fs");
const path = require("node:path");

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * { [worker]: { gooseProviderId?, gooseBaseUrl? } }.
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string } }} deps
 */
function createGooseSetRecord({ dir, safeStorage }) {
  const file = path.join(dir, "vault", "worker-goose.json");
  /** @returns {Record<string, { gooseProviderId?: string, gooseBaseUrl?: string }>} */
  function read() {
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {
    /** Merges a signed change into the worker's record: a field the change leaves out keeps what was set before. */
    set(worker, change) {
      if (!isObject(change)) return;
      const all = read();
      const next = { ...all[worker] };
      for (const key of ["gooseProviderId", "gooseBaseUrl"]) if (typeof change[key] === "string") next[key] = change[key];
      all[worker] = next;
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, safeStorage().encryptString(JSON.stringify(all)).toString("base64"), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    /** The provider and endpoint last set for the worker, "" for one never set; null when this Mac set neither. */
    of(worker) {
      const r = read()[worker];
      if (!isObject(r) || (typeof r.gooseProviderId !== "string" && typeof r.gooseBaseUrl !== "string")) return null;
      return { providerId: typeof r.gooseProviderId === "string" ? r.gooseProviderId : "", baseUrl: typeof r.gooseBaseUrl === "string" ? r.gooseBaseUrl : "" };
    },
  };
}

module.exports = { createGooseSetRecord };
