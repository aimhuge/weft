// POST /api/connectors/pin, on weft.zip, for Electron main: a worker vouched for, the sign and box keys this Mac checked
// and pinned when it paired the worker, signed by its approval key (lib/connector-signed.ts pinWorker). The mint serves
// only a worker a trusted Mac vouched for, with the sign key its row has now.
import { connectorRoute, jsonBody } from "@/lib/connector-route";
import { pinWorker } from "@/lib/connector-signed";
import { requestMeta } from "@/lib/connector-signer-links";

export async function POST(req: Request) {
  const body = await jsonBody(req);
  return connectorRoute(req, (deps, user) => pinWorker(deps, user.id, body, requestMeta(req)));
}
