import { captureOnboarding } from "@/lib/telemetry-send";
import { telemetryVerdict } from "@/lib/telemetry-limit";

// The deployed Weft's collector for desktop onboarding stats (lib/telemetry.ts). Every Mac posts here, so it has no
// localhost guard: it takes only allow-listed events, their listed props and an anonymous ID, and drops the rest.
// lib/telemetry-limit.ts caps each address and turns away cross-site browser posts before any of that.

export async function POST(req: Request) {
  const verdict = telemetryVerdict(req.headers);
  if (!verdict.ok) {
    const headers = verdict.status === 429 ? { "retry-after": String(verdict.retryAfter) } : undefined;
    return new Response(null, { status: verdict.status, headers });
  }
  const body: unknown = await req.json().catch(() => null);
  return new Response(null, { status: await captureOnboarding(body) });
}
