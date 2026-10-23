import { captureOnboarding } from "@/lib/telemetry-send";

// The deployed Weft's collector for desktop onboarding stats (lib/telemetry.ts). Every Mac posts here, so it has no
// localhost guard: it takes only allow-listed events, their listed props and an anonymous ID, and drops the rest.

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  return new Response(null, { status: await captureOnboarding(body) });
}
