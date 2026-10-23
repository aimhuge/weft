import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { setTelemetryOn, telemetryOn } from "@/lib/telemetry";
import { forwardOnboarding } from "@/lib/telemetry-send";

// The board's side of the anonymous onboarding stats (lib/telemetry.ts): GET and PUT the switch, POST an event, which
// goes on to the deployed Weft only while the switch is on.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ on: telemetryOn() });
}

// A privacy switch, so only Weft's own window may flip it (like Settings), never a thread's curl.
export async function PUT(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { on } = (await req.json()) as { on?: unknown };
    if (typeof on !== "boolean") throw new Error("on must be true or false.");
    setTelemetryOn(on);
    return Response.json({ on });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const { event, props } = (await req.json().catch(() => ({}))) as { event?: unknown; props?: unknown };
  const sent = await forwardOnboarding(event, props);
  return Response.json({ sent });
}
