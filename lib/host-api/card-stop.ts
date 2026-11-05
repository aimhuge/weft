import { stop } from "../runner";
import { OK, type Ok } from "./types";

export async function stopCard({ id }: { id: string }): Promise<Ok> {
  await stop(id);
  return OK;
}
