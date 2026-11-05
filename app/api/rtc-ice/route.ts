import { connection } from "next/server";
import { elevated } from "@/lib/guard";
import { mintIce } from "@/lib/rtc-ice";

// The ICE servers for a session line to a worker (lib/rtc-ice.ts): STUN, plus short-lived Cloudflare TURN credentials
// when this server holds CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN. Only Weft's own window asks: a
// TURN allocation is billed relay traffic, so a thread's curl doesn't get one.
export async function GET(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  return Response.json(await mintIce());
}
