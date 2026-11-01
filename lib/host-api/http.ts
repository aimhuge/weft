// The local host's side of a verb's error: the route's JSON error reply, with a missing card as 404.
import { fail } from "@/lib/guard";
import { NotFound } from "./types";

export function hostFail(err: unknown, status = 400): Response {
  return fail(err, err instanceof NotFound ? 404 : status);
}
