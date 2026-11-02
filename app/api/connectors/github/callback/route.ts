// GET /api/connectors/github/callback, on weft.zip: GitHub sends you back here with a code. Only the signed-in visitor
// whose browser started the flow (the MACed cookie /start's POST set, naming the same state) gets the code traded; the
// tokens are stored sealed for that account (lib/connector-connect.ts finishConnect). The page says what happened;
// Settings → Devices on the Mac then shows GitHub as connected.
import { cookies } from "next/headers";
import { connection } from "next/server";
import { callbackUrl, checkConnect, connectCookie, donePage, finishConnect } from "@/lib/connector-connect";
import { connectorDeps } from "@/lib/connector-deps";
import { webRequestOrigin } from "@/lib/web-auth";
import { webUser } from "@/lib/web-session";

export async function GET(req: Request) {
  await connection();
  const deps = connectorDeps();
  if (!deps) return donePage("Not set up yet", "GitHub connectors aren't set up on this server yet.");
  const url = new URL(req.url);
  const origin = webRequestOrigin(req);
  const name = connectCookie(origin.startsWith("https:"));
  const jar = await cookies();
  const kept = jar.get(name)?.value;
  jar.delete({ name, path: "/" });
  const user = await webUser();
  if (!user) return donePage("Sign in first", "Sign in to Weft on weft.zip, then connect GitHub again from Settings → Devices.");
  if (url.searchParams.get("error")) return donePage("Not connected", "GitHub didn't authorize the Weft app. Try again from Settings → Devices.");
  const flow = checkConnect(kept, user.id, url.searchParams.get("state"), deps.key);
  const code = url.searchParams.get("code");
  if (!flow || !code) return donePage("Not connected", "That link didn't come from your own Connect GitHub. Start again from Settings → Devices.");
  try {
    const login = await finishConnect(deps, user.id, { code, verifier: flow.verifier, redirectUri: callbackUrl(origin), previous: flow.previous });
    return donePage("GitHub connected", `Weft can now act as @${login} on your workers, once you turn GitHub on for one in Settings → Devices. You can close this tab.`);
  } catch (err) {
    return donePage("Not connected", (err as Error).message);
  }
}
