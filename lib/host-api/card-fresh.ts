import { sendFresh } from "@/lib/splice";
import { OK, type Ok } from "./types";

// "Send fresh" on a card with a cold prompt cache: a new session in the same card, started from a brief of the
// thread, with the message typed in the reply box (lib/splice.ts).
export async function sendFreshVerb({ id, message }: { id: string; message?: string }): Promise<Ok> {
  await sendFresh(id, message ?? "");
  return OK;
}
