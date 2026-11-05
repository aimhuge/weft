import { answerHook, isGuardCli, isGuardEvent } from "@/lib/guards/hook";
import { bridgeToken } from "@/lib/mcp-bridge";

// Weft's guards for a Codex or Goose turn (lib/guards/hook.ts): the CLI's own hook posts each tool call here and
// prints the answer. Not the guard()'s x-weft-token header: the hook is a CLI's child, and the turn's bearer token
// (lib/guards/turn.ts) is what says whose call this is. Any status but 200 makes the hook refuse the call.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function POST(req: Request, { params }: { params: Promise<{ cli: string; event: string }> }) {
  if (!LOCAL_HOSTS.has((req.headers.get("host") ?? "").replace(/:\d+$/, ""))) return Response.json({ error: "Forbidden host" }, { status: 403 });
  const { cli, event } = await params;
  if (!isGuardCli(cli) || !isGuardEvent(event)) return Response.json({ error: "Unknown CLI or event" }, { status: 404 });
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  const answer = await answerHook(cli, event, bridgeToken(req.headers.get("authorization")), payload, req.signal);
  return answer ? Response.json(answer) : Response.json({ error: "Unknown token" }, { status: 401 });
}
