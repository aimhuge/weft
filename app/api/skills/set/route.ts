import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { setAgentSkill } from "@/lib/agent-store";
import { agentSkillView, isSkillName, setCardSkill, setProjectSkill, skillSetView } from "@/lib/skill-set-actions";
import { getCard } from "@/lib/store";

// A project's skill set (?cwd=), a card's (?card=) or an agent's (?agent=): every skill and plugin, and whether it's on
// (lib/skill-sets.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const agent = params.get("agent");
    if (agent) return Response.json(agentSkillView(agent));
    const cardId = params.get("card");
    const card = cardId ? getCard(cardId) : undefined;
    const cwd = card?.cwd ?? params.get("cwd");
    if (!cwd) return Response.json({ error: "Pass ?cwd= or a card that exists." }, { status: 400 });
    return Response.json(skillSetView(cwd, card));
  } catch (err) {
    return fail(err);
  }
}

// { cwd, name, on } changes the project's default set; { card, name, on } just that card's; { agent, name, on } every
// thread with that agent (Weft's own window only, like every other change to an agent).
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { cwd?: unknown; card?: unknown; agent?: unknown; name?: unknown; on?: unknown };
    if (!isSkillName(body.name) || typeof body.on !== "boolean") throw new Error("name and on are required.");
    if (typeof body.agent === "string") {
      const loose = elevated(req);
      if (loose) return loose;
      setAgentSkill(body.agent, body.name, body.on);
      return Response.json(agentSkillView(body.agent));
    }
    if (typeof body.card === "string") {
      const card = await setCardSkill(body.card, body.name, body.on);
      if (!card) return Response.json({ error: "No such card." }, { status: 404 });
      return Response.json(skillSetView(card.cwd, card));
    }
    if (typeof body.cwd !== "string" || !body.cwd) throw new Error("cwd or card is required.");
    setProjectSkill(body.cwd, body.name, body.on);
    return Response.json(skillSetView(body.cwd));
  } catch (err) {
    return fail(err);
  }
}
