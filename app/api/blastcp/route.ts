import { fail, elevated } from "@/lib/guard";
import { connectBlastcpWithWeft } from "@/lib/blastcp-auto";

// The BlastCP drawer's "Connect with your Weft account" (lib/blastcp-auto.ts): swaps the Weft account's sign-in
// for a BlastCP one in Electron main. Answers only the outcome; the tokens never come back here.
// `elevated`, not `guard`: this replaces a stored credential, the same power as answering a permission prompt,
// so it needs Weft's own launch token rather than the "1" a thread's curl may send.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    return Response.json(await connectBlastcpWithWeft(true));
  } catch (err) {
    return fail(err);
  }
}
