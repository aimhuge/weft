// POST /api/connectors/signers/endorse, on weft.zip, for Electron main: a trusted Mac vouches for another Mac key of
// yours after Touch ID, so it's trusted now instead of after its day (lib/connector-signers.ts endorseSigner).
import { connectorRoute, jsonBody } from "@/lib/connector-route";
import { endorseSigner } from "@/lib/connector-signers";

export async function POST(req: Request) {
  const body = await jsonBody(req);
  return connectorRoute(req, async (deps, user) => ({ signer: await endorseSigner(deps, user.id, body) }));
}
