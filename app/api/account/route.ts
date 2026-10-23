import { after, connection } from "next/server";
import { accountView, sendMagicLink, signOut, startSignIn } from "@/lib/account";
import { emitPostHogLog, flushPostHogLogs } from "@/instrumentation";
import { fail, guard } from "@/lib/guard";
import { isDeployed } from "@/lib/home";
import type { AccountProvider } from "@/lib/types";
import { webUser } from "@/lib/web-session";

// Your Weft account: who's signed in, or that no one is.
export async function GET(req: Request) {
  if (isDeployed()) {
    try {
      const user = await webUser();
      logAccountLifecycle("account_session_loaded", { authentication_mode: "web", account_present: Boolean(user) });
      return Response.json({
        configured: true,
        user: user && { ...user, provider: null },
      });
    } catch (err) {
      return fail(err, 500);
    }
  }

  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const view = await accountView();
    logAccountLifecycle("account_session_loaded", { authentication_mode: "desktop", account_present: Boolean(view.user) });
    return Response.json(view);
  } catch (err) {
    return fail(err, 500);
  }
}

function logAccountLifecycle(message: string, attributes: Record<string, boolean | string>) {
  emitPostHogLog(message, attributes);
  after(flushPostHogLogs);
}

// The origin the board reached this server on; guard() already checked it's this machine.
function origin(req: Request) {
  return `http://${req.headers.get("host")}`;
}

// { action: "oauth", provider } returns the page to open in the system browser; "email" sends a
// magic link; "signout" forgets the session here. Both come back to ./callback.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const text = (key: string) => {
      const value = body[key];
      return typeof value === "string" ? value : "";
    };
    switch (body.action) {
      case "oauth": {
        const url = await startSignIn(text("provider") as AccountProvider, origin(req));
        logAccountLifecycle("account_sign_in_started", { sign_in_method: "oauth" });
        return Response.json({ url });
      }
      case "email":
        await sendMagicLink(text("email"), origin(req));
        logAccountLifecycle("account_sign_in_started", { sign_in_method: "email" });
        return Response.json({ ok: true });
      case "signout":
        await signOut();
        logAccountLifecycle("account_signed_out", { authentication_mode: isDeployed() ? "web" : "desktop" });
        return Response.json({ ok: true });
      default:
        throw new Error("Unknown account action.");
    }
  } catch (err) {
    return fail(err);
  }
}
