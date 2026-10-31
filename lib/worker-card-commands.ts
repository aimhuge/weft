// The commands that act on a card a Weft Worker already runs, from the board's composer and picker: reply, answer,
// stop, mode and input. lib/worker-daemon.ts claims and reports them; each returns the card it touched.
import { answerBody, answerGrant, replyBody, stopBody, type CloudCommandRow } from "./cloud-commands";
import type { Card } from "./types";
import type { Engine } from "./worker-daemon";
import { inputBody, modeBody } from "./worker-commands";

export function createCardCommands(engine: Engine) {
  function ownCard(cardId: string | undefined): Card {
    const card = cardId ? engine.getCard(cardId) : undefined;
    if (!card || card.role === "copilot") throw new Error("That thread isn't on this worker.");
    return card;
  }

  return {
    reply(command: CloudCommandRow): string {
      const reply = replyBody(command);
      if (!reply) throw new Error("That reply is empty.");
      engine.reply(ownCard(reply.cardId).id, reply.text);
      return reply.cardId;
    },
    answer(command: CloudCommandRow): string {
      const answer = answerBody(command);
      if (!answer) throw new Error("That answer is empty.");
      const card = ownCard(answer.cardId);
      // Read before the answer clears the request; written after it, so one that has gone leaves no grant behind.
      const grant = answerGrant(answer, card.pending);
      engine.answer(card.id, answer.allow, answer.answers, answer.pendingId);
      if (grant) engine.grant(card.id, grant.directory, grant.scope);
      return answer.cardId;
    },
    async stop(command: CloudCommandRow): Promise<string> {
      const card = ownCard(stopBody(command)?.cardId);
      await engine.stop(card.id);
      return card.id;
    },
    mode(command: CloudCommandRow): string {
      const body = modeBody(command);
      if (!body) throw new Error("That mode can't be set on a worker.");
      const card = ownCard(body.cardId);
      if (card.backend === "codex" && card.sessionId) throw new Error("Codex keeps its sandbox mode for this session.");
      engine.setMode(card.id, body.mode);
      return card.id;
    },
    async input(command: CloudCommandRow): Promise<string> {
      const body = inputBody(command);
      if (!body) throw new Error("That tap is empty.");
      const card = ownCard(body.cardId);
      await engine.input(body.input);
      return card.id;
    },
  };
}
