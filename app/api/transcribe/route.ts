import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { dictationStatus, transcribe, warmIfAdvanced } from "@/lib/transcribe";

// Whether dictation can run here, and why not. The mic asks as it opens, so Advanced dictation's
// server starts warming while you talk.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  warmIfAdvanced();
  return Response.json(dictationStatus());
}

// The body is a recording from the mic button; the reply is its text. ?lang= is the board's language.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const audio = Buffer.from(await req.arrayBuffer());
    if (!audio.length) throw new Error("Nothing was recorded.");
    const type = req.headers.get("content-type") ?? "";
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
    return Response.json({ text: await transcribe(audio, ext, new URL(req.url).searchParams.get("lang")) });
  } catch (err) {
    return fail(err);
  }
}
