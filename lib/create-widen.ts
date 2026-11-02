// A new thread with an agent from the network (docs/architecture/project-hosts.md#signed-widening-as-built): `run` on a
// worker, `new_card` on a Mac. An agent is who the thread is, so like changing a running card's agent it needs a signed
// approval, here bound to the agent, the folder the host starts it in and its first message. Without `agent` the run
// is what it always was; with one and no approval, it's refused.
import type { CloudCommandRow } from "./cloud-commands";
import type { WidenTarget } from "./widen-check";

export const AGENT_REFUSED = "A new thread with an agent needs your approval: start it from Weft on your Mac, or approve it with your passkey.";

export type WidenCheck = (target: WidenTarget, auth: unknown, refusal: string) => Promise<string | null>;

const field = (payload: unknown, key: string): unknown => (payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined);

// The agent a new thread may start with, once its approval checks out; undefined when it names none. `folder` is the
// folder as this host resolved it (a Mac's synced path, a worker's project name).
export async function signedAgent(command: Pick<CloudCommandRow, "payload">, folder: string, check: WidenCheck | undefined): Promise<string | undefined> {
  const agent = field(command.payload, "agent");
  if (agent === undefined || agent === null || agent === "") return undefined;
  if (typeof agent !== "string") throw new Error("That agent isn't a name.");
  const prompt = field(command.payload, "prompt");
  const change = { create: { agent, folder, prompt: typeof prompt === "string" ? prompt : "" } };
  const problem = check ? await check({ card: "", verb: "card.create", change }, field(command.payload, "widen"), AGENT_REFUSED) : AGENT_REFUSED;
  if (problem) throw new Error(problem);
  return agent;
}
