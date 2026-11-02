// The nonces of the widening approvals a host has run (docs/architecture/project-hosts.md#signed-widening-as-built), so
// a signed approval runs once: a second command carrying the same one, from the relay, the line or a replayed row, is
// refused. Each is kept until its approval would be too old anyway (lib/widen-check.ts), and on disk, so a host that
// restarts inside that window doesn't forget one.
import fs from "node:fs";
import path from "node:path";

export interface NonceStore {
  load(): Record<string, number>;
  save(nonces: Record<string, number>): void;
}

export interface NonceBook {
  has(nonce: string): boolean;
  // Marks a nonce used until `until`; false when it was already used, so of two racing commands only one runs.
  take(nonce: string, until: number): boolean;
}

export function nonceBook(store: NonceStore, now: () => number = Date.now): NonceBook {
  let kept: Record<string, number> | null = null;
  const live = () => {
    const at = now();
    kept = Object.fromEntries(Object.entries(kept ?? store.load()).filter(([, until]) => until > at));
    return kept;
  };
  return {
    has: (nonce) => Object.hasOwn(live(), nonce),
    take(nonce, until) {
      const nonces = live();
      if (Object.hasOwn(nonces, nonce)) return false;
      nonces[nonce] = until;
      store.save(nonces);
      return true;
    },
  };
}

// A JSON file, mode 600. One that won't read starts empty: the approvals in it are at most a couple of minutes old, and
// a file a thread could tamper with sits in the host's own data folder, not the card's.
export function fileNonceStore(file: string): NonceStore {
  return {
    load() {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, number] => typeof e[1] === "number"));
      } catch {
        return {};
      }
    },
    save(nonces) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(nonces), { mode: 0o600 });
    },
  };
}
