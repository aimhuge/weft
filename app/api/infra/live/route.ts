import { connection } from "next/server";
import { guard } from "@/lib/guard";
import { providerStates, quotaRows, readEgress, readInfraLive, type EgressLive, type InfraLive, type InfraSnapshot } from "@/lib/infra-live";
import { SUPABASE_URL } from "@/lib/supabase-project";

// The live infrastructure behind the repo-analysis report (lib/infra-live.ts, docs/architecture/repo-analysis.md).
//
// The report page is a file in ~/.weft/show, but its numbers go stale the moment it is written. This route
// reads them fresh and the page fetches it on open, so the report says what is true now.
//
// Two credentials, and they are different things:
//   - SUPABASE_SECRET_KEY (the project's secret key) reads `public.infra_live()` over PostgREST: the database
//     size, the file storage, the table and account counts.
//   - SUPABASE_ACCESS_TOKEN (a Management API personal access token) reads the log stream, which is the only
//     record of the EGRESS. Without it the route still answers, with the egress null and a note saying why.
//
// A missing or failing source never fails the whole route: the report shows one source's number and says the
// other is unread, which is more useful than an error page.

const PROJECT_REF = "lqjyravglujyizyqypxq";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();

  const notes: string[] = [];
  let live: InfraLive | null = null;
  let egress: EgressLive | null = null;

  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (serviceKey) {
    try {
      live = await readInfraLive(SUPABASE_URL, serviceKey);
    } catch (err) {
      notes.push(`The database numbers couldn't be read: ${(err as Error).message}`);
    }
  } else {
    notes.push("SUPABASE_SECRET_KEY isn't set, so the database numbers are unread.");
  }

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";
  if (accessToken) {
    try {
      egress = await readEgress(PROJECT_REF, accessToken);
    } catch (err) {
      notes.push(`The egress couldn't be read: ${(err as Error).message}`);
    }
  } else {
    notes.push("SUPABASE_ACCESS_TOKEN isn't set, so the egress is unread. It's a Supabase personal access token, from supabase.com/dashboard/account/tokens.");
  }

  const snapshot: InfraSnapshot = {
    at: new Date().toISOString(),
    live,
    egress,
    providers: providerStates(process.cwd()),
    quotas: quotaRows(live, egress),
    notes,
  };
  return Response.json(snapshot);
}
