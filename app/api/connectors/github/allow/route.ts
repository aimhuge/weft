// POST /api/connectors/github/allow, on weft.zip, for Electron main: an Allow for one project or card under a per-project
// or per-card approval, signed by this Mac's approval key after Touch ID (lib/connector-signed.ts writeAllow).
import { connectorRoute, jsonBody } from "@/lib/connector-route";
import { writeAllow } from "@/lib/connector-signed";

export async function POST(req: Request) {
  const body = await jsonBody(req);
  return connectorRoute(req, (deps, user) => writeAllow(deps, user.id, body));
}
