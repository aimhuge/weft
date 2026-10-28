// The gate for the team's Devices API (app/api/team/devices). Both routes answer for one workspace, so
// both need the same three things: who is asking, which workspace, and whether they may act on it.
//
// Two ways in, one verdict. A browser on weft.zip has the cookie session (lib/web-session's `webUser`);
// the desktop's Weft has a Supabase access token and sends it as `Authorization: Bearer <jwt>`, because
// the Mac never holds a cookie for weft.zip. The bearer wins when both are present — it is the more
// specific credential — and the cookie is the fallback.
//
// The verdict is the gate lib/teams.ts already builds for every team page: membership plus the viewer's
// role. A member who isn't in the workspace gets the same "denied" as a workspace that doesn't exist, so
// membership can't be probed by varying the slug.
import { roleCan } from "@aimhuge/teams";
import type { TeamContext } from "@/lib/teams";
import { teamAccessFor } from "@/lib/teams";
import { bearerUser, webUser } from "@/lib/web-session";
import type { WebUser } from "@/lib/web-session";

// The four answers a route can give. `unconfigured` is a Weft without a service key: the same shape
// app/api/teams answers with, so a client can tell "we can't help you" from "you can't do that".
export type DeviceAccess = { kind: "ok"; ctx: TeamContext } | { kind: "signed-out" } | { kind: "denied" } | { kind: "unconfigured" };

// Who is asking, whichever way they authenticated. Returns null when neither credential is good.
export async function deviceUser(req: Request): Promise<WebUser | null> {
  const bearer = await bearerUser(req);
  if (bearer) return bearer;
  return webUser();
}

// The workspace gate: the user, the org, their role. `org` is the slug the caller asked about.
export async function deviceAccess(req: Request, org: string): Promise<DeviceAccess> {
  const user = await deviceUser(req);
  if (!user) return { kind: "signed-out" };
  const access = await teamAccessFor(user, org);
  if (access.kind === "signed-out") return { kind: "signed-out" };
  if (access.kind !== "ok") return { kind: "denied" };
  return { kind: "ok", ctx: access.ctx };
}

// Whether the viewer may grant a device into the workspace. Granting is an admin's job: the grant
// hands a machine the right to hold the workspace's vault key, and the RLS on
// `pending_device_grants` says the same thing ("only org admins can share a vault").
export function canGrantDevices(ctx: TeamContext): boolean {
  return roleCan(ctx.role, "members.manage");
}
