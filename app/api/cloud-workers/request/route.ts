import { handleRequest } from "@/lib/cloud-worker-request";

// The home page's Cloud Workers form posts here (lib/cloud-worker-request.ts). Any visitor can, so it has no
// localhost guard: the body is checked and rate-limited per address by the feedback collector it goes through.
export async function POST(req: Request) {
  return handleRequest(req);
}
