// A Weft Worker's side of the GitHub connector (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// the daemon asks weft.zip's minter (app/api/connectors/github/mint) for a card's token, with its `wwk_` key and a
// signature by its pairing sign key over every field, and keeps the answer in memory only, per card and repo, until
// HOLD_MARGIN_MS before the expiry weft.zip handed out (never on disk, never in a card's env). The socket the card's git
// and gh reach it through is lib/connector-socket.ts.
import { HOLD_MARGIN_MS, mintMessage, type Connector } from "./connector-grant";

export interface Minted {
  token: string;
  expiresAt: number;
  login: string;
  asks: string[];
}

export interface ClientDeps {
  site: string;
  key: string;
  workerId: string;
  sign: (message: string) => string;
  nonce: () => string;
  fetch: typeof fetch;
  now: () => number;
}

export function connectorClient(deps: ClientDeps) {
  const held = new Map<string, Minted>();
  const slot = (cardId: string, repo: string) => `${cardId}\n${repo.toLowerCase()}`;

  async function ask(cardId: string, repo: string, connector: Connector): Promise<Minted> {
    const request = { workerId: deps.workerId, cardId, connector, repo, ts: deps.now(), nonce: deps.nonce() };
    const body = { connector, cardId, repo, ts: request.ts, nonce: request.nonce, sig: deps.sign(mintMessage(request)) };
    let res: Response;
    try {
      res = await deps.fetch(`${deps.site}/api/connectors/github/mint`, { method: "POST", headers: { authorization: `Bearer ${deps.key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new Error("Couldn't reach weft.zip for a GitHub token.");
    }
    const got = (await res.json().catch(() => ({}))) as { token?: unknown; expiresAt?: unknown; login?: unknown; asks?: unknown; error?: unknown };
    if (!res.ok || typeof got.token !== "string" || typeof got.expiresAt !== "string") throw new Error(typeof got.error === "string" ? got.error : `weft.zip answered HTTP ${res.status}.`);
    return { token: got.token, expiresAt: Date.parse(got.expiresAt), login: typeof got.login === "string" ? got.login : "", asks: Array.isArray(got.asks) ? got.asks.filter((a): a is string => typeof a === "string") : [] };
  }

  return {
    // The card's token for that repo: the one held while it has more than the margin left, else a fresh one.
    async get(cardId: string, repo: string, connector: Connector = "github"): Promise<Minted> {
      const kept = held.get(slot(cardId, repo));
      if (kept && kept.expiresAt - HOLD_MARGIN_MS > deps.now()) return kept;
      held.delete(slot(cardId, repo));
      const minted = await ask(cardId, repo, connector);
      held.set(slot(cardId, repo), minted);
      return minted;
    },
    // git said the token didn't work (`erase`): drop it, so the next ask mints.
    forget(cardId: string) {
      for (const k of held.keys()) if (k.startsWith(`${cardId}\n`)) held.delete(k);
    },
    // Everything, when the daemon stops.
    clear: () => held.clear(),
  };
}

export type ConnectorClient = ReturnType<typeof connectorClient>;
