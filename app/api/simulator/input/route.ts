import { connection } from "next/server";
import { elevated, fail } from "@/lib/guard";
import { parseInput, sendInput } from "@/lib/simulator-input";

// The simulator live view's taps and swipes. Electron main sends them from Weft's own viewer page
// (electron/sim-live.cjs) with the launch token, so a thread's plain "1" can't drive a device through here.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  try {
    const done = await sendInput(parseInput(await req.json()));
    return Response.json({ ok: true, done });
  } catch (err) {
    return fail(err);
  }
}
