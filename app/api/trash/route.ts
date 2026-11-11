import { listTrash } from "@/lib/card-trash";
import { guard } from "@/lib/guard";

// The Done column's Recently deleted list (docs/architecture/card-trash.md): cards deleted in the last 30 days,
// newest first. Reading it purges the older ones.
export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  return Response.json({ items: listTrash() });
}
