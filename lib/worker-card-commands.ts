// The commands that act on a card a Weft Worker already runs, from the board's composer and picker: reply, answer,
// stop, mode, input, qa and host. lib/worker-daemon.ts claims and reports them; each returns the card it touched.
//
// reply, answer, stop and host are the host core's shared card kinds (lib/host/dispatch.ts), run through the same
// runVerb the desktop's routes run, so there is one code path; this file gives them the worker's CardRules: its own
// cards only (never the copilot), pasted files brought over first, an answer's folder grant through the engine. mode,
// input and qa are the worker's own kinds: mode is card.update's permissionMode within CARD_MODES (never
// bypassPermissions), and leaves a Codex session in its sandbox mode.
import type { CloudCommandRow } from "./cloud-commands";
import { cardKinds, type CardRules } from "./host/dispatch";
import type { Card } from "./types";
import type { Engine } from "./worker-daemon";
import { inputBody, modeBody, qaBody } from "./worker-commands";
import { placeUpdate, workerWidenCheck, type WorkerWiden } from "./worker-widen";

// A card this worker runs, and never its copilot.
function ownCard(engine: Engine, cardId: string | undefined): Card {
  const card = cardId ? engine.getCard(cardId) : undefined;
  if (!card || card.role === "copilot") throw new Error("That thread isn't on this worker.");
  return card;
}

// `widen` is the worker's signed-widening side (lib/worker-widen.ts): without it, every widening stays refused.
export function workerRules(engine: Engine, create?: CardRules["create"], lists?: CardRules["lists"], owner?: string, widen?: WorkerWiden): CardRules {
  return {
    // The worker only claims its owner's commands (worker_pending and worker_claim check created_by); this is the same
    // rule again at the verb, for the ones that reach the owner's Mac or the internet (OWNER_VERBS).
    fromOwner: (command) => Boolean(owner) && command.created_by === owner,
    ...(create ? { create } : {}),
    ...(lists ? { lists } : {}),
    card: (cardId) => ownCard(engine, cardId),
    async verb(verb, args) {
      if (!widen) return engine.host(verb, args);
      const placed = placeUpdate(widen, verb, args, { id: String(args.id) });
      const reply = await engine.host(verb, placed.args);
      placed.after();
      return reply;
    },
    widen: widen && workerWidenCheck(widen),
    // A worker's own settings, edited from your Mac's Settings (only HOST_SETTINGS; remoteRefusal and the verb check).
    hostVerb: (verb, args) => engine.host(verb, args),
    grant: (cardId, directory, scope) => engine.grant(cardId, directory, scope),
    receive: (text, payload) => engine.receive(text, payload),
    // The editor's files.* results over the row's 4 KB go up as blobs (lib/host-result.ts).
    carry: engine.carry,
  };
}

// `create` is the daemon's card.create (lib/worker-kinds.ts): a card in the row's checkout, published before the report.
// `lists` runs cron.* and webhook.* on this worker's own crons and webhooks (lib/worker-kinds.ts). `widen` as workerRules'.
export function createCardCommands(engine: Engine, create?: CardRules["create"], lists?: CardRules["lists"], owner?: string, widen?: WorkerWiden) {
  return {
    ...cardKinds(workerRules(engine, create, lists, owner, widen)),
    async mode(command: CloudCommandRow): Promise<string> {
      const body = modeBody(command);
      if (!body) throw new Error("That mode can't be set on a worker.");
      const card = ownCard(engine, body.cardId);
      if (card.backend === "codex" && card.sessionId) throw new Error("Codex keeps its sandbox mode for this session.");
      await engine.host("card.update", { id: card.id, body: { permissionMode: body.mode } });
      return card.id;
    },
    async input(command: CloudCommandRow): Promise<string> {
      const body = inputBody(command);
      if (!body) throw new Error("That tap is empty.");
      const card = ownCard(engine, body.cardId);
      await engine.input(body.input, card.id);
      return card.id;
    },
    // Local Simulator mode (docs/architecture/manual-qa.md): the card's device tools go to this Mac, or stop.
    qa(command: CloudCommandRow): string {
      const body = qaBody(command);
      if (!body) throw new Error("That QA switch is empty.");
      const card = ownCard(engine, body.cardId);
      engine.setQa(card.id, body.device);
      return card.id;
    },
  };
}
