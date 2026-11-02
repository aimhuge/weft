import { githubRepoOf } from "./repos";
import { NO_PROVIDER, NO_SECRET } from "./webhook-forward";
import { getWebhook, providerFor, setRelay, type Webhook } from "./webhooks";
import { askMac } from "./worker-mac-ask";

// mcp__webhooks__relay on a Weft Worker (docs/architecture/webhooks.md#on-a-worker). A worker has no Weft session and
// no vault, so its owner's Mac makes the relay: a `relay_create` call carries the webhook's names (provider, secret
// name, the checkout's GitHub repo, the target), the Mac seals the secret from its vault for that repo after Touch ID
// and inserts the row as the owner, naming this worker and the server (lib/device-call-approvals.ts). Deliveries then
// reach the route through this worker's tunnel to that server, and the provider gets its real answer.

export const RELAY_TOOL = "relay_create";

export async function createRelayOnWorker(id: string, cardId: string | undefined): Promise<Webhook> {
  const hook = getWebhook(id);
  if (!hook) throw new Error("That webhook is gone.");
  if (hook.relayId) return hook;
  const provider = providerFor(hook);
  if (!provider) throw new Error(NO_PROVIDER);
  if (!hook.secret) throw new Error(NO_SECRET);
  const repo = githubRepoOf(hook.folder);
  if (!repo) throw new Error("A relay on a worker needs the project's GitHub repo, which names its 🔐 vault, and this checkout has no GitHub origin.");
  const answer = await askMac(cardId, RELAY_TOOL, { name: hook.name, provider, secret: hook.secret, repo, target: hook.target });
  if (answer.denied) throw new Error("Weft didn't get your Touch ID, so no relay was created.");
  if (answer.missing) throw new Error(`${hook.secret} has no value in the vault yet — add it in 🔐 on your Mac, then call relay again.`);
  if (typeof answer.relayId !== "string" || typeof answer.url !== "string") throw new Error("Your Mac didn't make the relay.");
  return setRelay(id, { relayId: answer.relayId, url: answer.url });
}
