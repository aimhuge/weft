import { restoreFromTrash } from "@/lib/card-trash";
import { fail, guard } from "@/lib/guard";

type Ctx = { params: Promise<{ id: string }> };

// Restore: the deleted card and its thread go back on the board (in Review if it was running), and the board hears
// of it over the event stream like any new card.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ card: restoreFromTrash(id) });
  } catch (err) {
    return fail(err);
  }
}
