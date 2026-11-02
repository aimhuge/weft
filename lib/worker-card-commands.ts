// The commands that act on a card a Weft Worker already runs, from the board's composer and picker: reply, answer,
// stop, mode, input, qa and host. lib/worker-daemon.ts claims and reports them; each returns the card it touched.
//
// reply, answer, stop and mode are aliases of host verbs (card.message, card.permission.answer, card.stop and
// card.update's permissionMode), run through the same runVerb the desktop's routes run, so there is one code path.
// The old kinds stay on the wire for the phone and weft.zip. What only a worker does stays here as validation: an
// answer's folder grant, and mode's CARD_MODES (never bypassPermissions).
import { answerBody, answerGrant, replyBody, stopBody, type CloudCommandRow } from "./cloud-commands";
import { hostResult, readHostCommand, remoteRefusal, textArgOf, type HostDone } from "./host-command";
import type { Card } from "./types";
import type { Engine } from "./worker-daemon";
import { inputBody, modeBody, qaBody } from "./worker-commands";

export function createCardCommands(engine: Engine) {
  function ownCard(cardId: string | undefined): Card {
    const card = cardId ? engine.getCard(cardId) : undefined;
    if (!card || card.role === "copilot") throw new Error("That thread isn't on this worker.");
    return card;
  }

  // The files a typed text pastes come over first (lib/attachment-transfer.ts), so the turn reads copies on this box.
  async function received(command: CloudCommandRow, args: Record<string, unknown>, field: string | undefined) {
    const typed = field ? args[field] : undefined;
    return field && typeof typed === "string" ? { ...args, [field]: await engine.receive(typed, command.payload) } : args;
  }

  return {
    async reply(command: CloudCommandRow): Promise<string> {
      const reply = replyBody(command);
      if (!reply) throw new Error("That reply is empty.");
      const card = ownCard(reply.cardId);
      await engine.host("card.message", await received(command, { id: card.id, text: reply.text }, "text"));
      return reply.cardId;
    },
    async answer(command: CloudCommandRow): Promise<string> {
      const answer = answerBody(command);
      if (!answer) throw new Error("That answer is empty.");
      const card = ownCard(answer.cardId);
      // Read before the answer clears the request; written after it, so one that has gone leaves no grant behind.
      const grant = answerGrant(answer, card.pending);
      await engine.host("card.permission.answer", { id: card.id, allow: answer.allow, answers: answer.answers, pendingId: answer.pendingId });
      if (grant) engine.grant(card.id, grant.directory, grant.scope);
      return answer.cardId;
    },
    async stop(command: CloudCommandRow): Promise<string> {
      const card = ownCard(stopBody(command)?.cardId);
      await engine.host("card.stop", { id: card.id });
      return card.id;
    },
    async mode(command: CloudCommandRow): Promise<string> {
      const body = modeBody(command);
      if (!body) throw new Error("That mode can't be set on a worker.");
      const card = ownCard(body.cardId);
      if (card.backend === "codex" && card.sessionId) throw new Error("Codex keeps its sandbox mode for this session.");
      await engine.host("card.update", { id: card.id, body: { permissionMode: body.mode } });
      return card.id;
    },
    async input(command: CloudCommandRow): Promise<string> {
      const body = inputBody(command);
      if (!body) throw new Error("That tap is empty.");
      const card = ownCard(body.cardId);
      await engine.input(body.input, card.id);
      return card.id;
    },
    // Local Simulator mode (docs/architecture/manual-qa.md): the card's device tools go to this Mac, or stop.
    qa(command: CloudCommandRow): string {
      const body = qaBody(command);
      if (!body) throw new Error("That QA switch is empty.");
      const card = ownCard(body.cardId);
      engine.setQa(card.id, body.device);
      return card.id;
    },
    // Any verb in lib/host-api, on a card this worker runs. Only a command the worker's owner made gets this far
    // (worker_pending and worker_claim match created_by to the owner), but anyone holding that account's session can
    // insert one, so remoteRefusal turns away what would widen the card: a shell, a new folder, agent or read scope.
    async host(command: CloudCommandRow): Promise<HostDone> {
      const body = readHostCommand(command);
      const card = ownCard(body.args.id);
      const refused = remoteRefusal(body);
      if (refused) throw new Error(refused);
      await engine.host(body.verb, await received(command, body.args, textArgOf(body.verb)));
      return { cardId: card.id, result: hostResult(card.id) };
    },
  };
}
