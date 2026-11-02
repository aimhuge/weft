// card.warm: start a card's CLI ahead of a reply, as opening it does on this Mac (POST /api/warm). A board sends it to a
// worker only over a session line that's up, never as a row (lib/project-host.ts warm), so opening a card costs nothing.
import { warmUp } from "../runner";
import { OK, settle, type Ok } from "./types";

export function warmCardVerb({ id }: { id: string }): Promise<Ok> {
  return settle(() => {
    warmUp(id);
    return OK;
  });
}
