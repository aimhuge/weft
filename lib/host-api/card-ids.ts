// The card ids card.create has used on this host (lib/host-api/card-create.ts), kept in the data folder so a card id is
// never made twice, even after its card was deleted: the GitHub connector's mint pins a card to its signed start, and a
// card re-created under an old id must not inherit it (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../store";

// Ids are uuids, ~37 bytes each: the newest this many stay, far more than one host makes in its life.
export const MAX_IDS = 100_000;

export function cardIds(file = path.join(DATA_DIR, "card-create-ids.json")) {
  const read = (): string[] => {
    try {
      const ids: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    used: (id: string) => read().includes(id),
    remember(id: string) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify([...read(), id].slice(-MAX_IDS)), { mode: 0o600 });
    },
  };
}
