import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { remoteDeps } from "@/lib/site-notes-live";
import { uploadRemote } from "@/lib/site-notes-remote";
import { sendOutbox } from "@/lib/site-notes-send";
import { listOutbox, publicSharingOn, queueOutbox, setPublicSharing, takeOutbox } from "@/lib/site-notes-store";

// The board's side of site notes (docs/architecture/site-notes.md#consent): GET the public-sharing switch and the
// outbox; PUT the switch; POST send or discard outbox notes. Consent is the user's, so the writes take Weft's own
// window (elevated), never a thread's curl.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ public: publicSharingOn(), outbox: listOutbox() });
}

export async function PUT(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { on } = (await req.json()) as { on?: unknown };
    if (typeof on !== "boolean") throw new Error("on must be true or false.");
    setPublicSharing(on);
    // Turning it off drops what was waiting: nothing goes out without the switch on.
    if (!on) takeOutbox(undefined);
    return Response.json({ public: on, outbox: listOutbox() });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { action, ids } = (await req.json()) as { action?: unknown; ids?: unknown };
    const picked = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : undefined;
    if (action === "discard") {
      takeOutbox(picked);
      return Response.json({ outbox: listOutbox() });
    }
    if (action !== "send") throw new Error("action must be send or discard.");
    if (!publicSharingOn()) throw new Error("Public sharing is off.");
    const results = await sendOutbox(picked, {
      take: (which) => takeOutbox(which),
      requeue: (item) => queueOutbox(item),
      upload: (u) => uploadRemote(u, remoteDeps),
    });
    return Response.json({ results, outbox: listOutbox() });
  } catch (err) {
    return fail(err);
  }
}
