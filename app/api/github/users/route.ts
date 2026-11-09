import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { searchGithubUsers, suggestPeople } from "@/lib/github-users";
import { getCard } from "@/lib/store";

// People for the share pickers (lib/github-users.ts): GET ?q=octo searches GitHub logins for the composer's @ and the
// Share dialog's People field; GET ?card=<id> with no q suggests the collaborators of that card's repo.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    if (q) return Response.json({ people: await searchGithubUsers(q) });
    const card = getCard(params.get("card") ?? "");
    return Response.json({ people: card ? await suggestPeople(card.cwd) : [] });
  } catch (err) {
    return fail(err);
  }
}
