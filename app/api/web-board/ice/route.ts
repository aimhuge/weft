// GET /api/web-board/ice — the ICE servers for a weft.zip session line to a worker (lib/web-ice.ts): STUN, plus
// short-lived Cloudflare TURN credentials when the deployment holds CLOUDFLARE_TURN_KEY_ID and
// CLOUDFLARE_TURN_KEY_API_TOKEN, for a signed-in owner of a live worker. The web board (lib/web-lines.ts webIce) and the
// phone (`Authorization: Bearer`, requestSession) call it; the desktop has its own (app/api/rtc-ice, behind the launch token).
import { NO_STORE } from "@/lib/app-share-reply";
import { webIce } from "@/lib/web-ice";
import { requestSession } from "@/lib/web-session";

export async function GET(req: Request) {
  const answer = await webIce(await requestSession(req));
  const retry: Record<string, string> = answer.status === 429 ? { "Retry-After": String(answer.retryAfter) } : {};
  return Response.json(answer.body, { status: answer.status, headers: { ...NO_STORE, ...retry } });
}
