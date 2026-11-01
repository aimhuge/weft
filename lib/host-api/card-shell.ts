import { runShell } from "@/lib/shell";
import { OK, settle, type Ok } from "./types";

// "!" in the reply box: starts your command in the card's folder. It answers once the command has started;
// the thread shows its output when it ends.
export function shellCommand({ id, command }: { id: string; command?: string }): Promise<Ok> {
  return settle(() => {
    runShell(id, (command ?? "").trim());
    return OK;
  });
}
