// POST /api/connectors/github/grant, on weft.zip, for Electron main (your Supabase session as a bearer): turns GitHub on
// for a worker or changes its settings, signed by this Mac's approval key after Touch ID (electron/connector-grants.cjs).
// The signature, its freshness and nonce, the worker's vouched pairing and the grant's epoch are checked
// (lib/connector-signed.ts); a stricter change also ends the worker's tokens at GitHub.
import { connectorRoute, jsonBody } from "@/lib/connector-route";
import { writeGrant } from "@/lib/connector-signed";

export async function POST(req: Request) {
  const body = await jsonBody(req);
  return connectorRoute(req, (deps, user) => writeGrant(deps, user.id, body));
}
