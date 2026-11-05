import { fail, guard } from "@/lib/guard";
import { fetchTestflight, requestInvite } from "@/lib/testflight-client";

// The board's side of the phone app's TestFlight (docs/architecture/mobile.md#testflight), forwarded to weft.zip:
// GET is the public link for the QR code (null hides it), POST emails the signed-in account an invite.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    return Response.json(await fetchTestflight());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await requestInvite());
  } catch (err) {
    return fail(err);
  }
}
