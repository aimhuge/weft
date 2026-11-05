// Goose's provider and endpoint on a Weft Worker (docs/architecture/weft-worker.md#goose-on-a-worker): where a Goose
// card's traffic goes, so never synced and never a plain host setting. A settings.put carries them only with a signed
// widening from the pairing Mac's Touch ID key (lib/host/dispatch.ts signedGoose, lib/widen-check.ts); this is the
// worker's check and save once that approval checked out. The provider's key isn't a setting: each Goose turn asks the
// paired Mac for it, which answers only for the provider and endpoint it signed here (lib/worker-goose-key.ts).
import { gooseBaseUrl, gooseProviderId, setGooseBaseUrl, setGooseProviderId } from "./settings";
import { providerById } from "./goose-provider";
import type { GooseSettings } from "@weft/client";

const URL_MAX = 500;

/** The Goose pair this host runs on, as settings.get reads it. */
export function gooseHostSettings(): Required<GooseSettings> {
  return { gooseProviderId: gooseProviderId(), gooseBaseUrl: gooseBaseUrl() };
}

// An endpoint is "" (none) or an http(s) URL with no credentials in it: a key in the URL would sit in settings.json.
function endpointProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length > URL_MAX) return "The Goose endpoint must be a web address.";
  if (!value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "The Goose endpoint must be a web address.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "The Goose endpoint must start with https:// or http://.";
  return url.username || url.password ? "Leave the key out of the Goose endpoint: it belongs in the worker's own environment." : null;
}

/** Checks both fields first, then saves them. Throws, saving nothing, when either doesn't check out. */
export function applyGooseSettings(fields: Record<string, unknown>): void {
  const { gooseProviderId: provider, gooseBaseUrl: url } = fields;
  if (provider !== undefined && (typeof provider !== "string" || (provider !== "" && !providerById(provider)))) throw new Error("Goose doesn't know that provider.");
  const problem = url === undefined ? null : endpointProblem(url);
  if (problem) throw new Error(problem);
  if (typeof provider === "string") setGooseProviderId(provider);
  if (typeof url === "string") setGooseBaseUrl(url);
}
