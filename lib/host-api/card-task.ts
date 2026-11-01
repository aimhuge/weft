import { stopTask } from "@/lib/task-stop";
import { OK, type Ok } from "./types";

// The task strip's Stop: ends one subagent or background command of the thread.
export async function stopTaskVerb({ id, taskId }: { id: string; taskId: string }): Promise<Ok> {
  await stopTask(id, taskId);
  return OK;
}
