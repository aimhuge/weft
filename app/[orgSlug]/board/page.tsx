// The /[orgSlug]/board page on weft.zip: a live, read-only mirror of the desktop's opted-in
// cards (docs/architecture/cloud-sync.md). Server-renders the initial cards, the initial
// thread for the open card (when ?card=… is set), and pre-resolves signed URLs for any blob
// refs the page will show. The <WebBoard> client component subscribes to Supabase Realtime
// and keeps the columns and the side panel current.
//
// Authentication: same gate as /[orgSlug]/team and /[orgSlug]/billing (requireTeam, lib/teams.ts).
// Reads go through the cookie-bound `webClient()` so RLS applies; the service role is never
// reachable from a client component. The Realtime channel's filter (org_id=eq.<id>) is the
// same field RLS uses to gate SELECT, and the project's RLS docs say the same SELECT policy
// gates what Realtime sends to a given connection — so a non-member cannot see another
// workspace's cards even if the URL leaked.
import type { Metadata } from "next";
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { requireTeam } from "@/lib/teams";
import { isOpenCommand, type CloudCommandRow } from "@/lib/cloud-commands";
import { BLOB_REF_PREFIX, THREAD_PAGE_SIZE, type CloudCardRow, type CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pageFromRows } from "@/lib/cloud-thread-page";
import { resolveBlobUrls } from "@/lib/blob-urls";
import { queueMirror } from "@/lib/r2-queue";
import { collectBlobRefs } from "@/lib/web-board";
import { cardThumbRefs } from "@/lib/web-board-thumbs";
import { webClient } from "@/lib/web-session";
import { WebBoard } from "@/components/web-board";
import "@/components/web-board/web-board.css";
import { BoardSkeleton } from "@/components/web-states/Skeletons";

export const metadata: Metadata = {
  title: "Board",
  description: "The desktop board, live and read-only, shared with everyone in the workspace.",
};

function NotDeployedCard({ slug }: { slug: string }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Board · {slug}</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

type Query = Record<string, string | string[] | undefined>;

async function readQuery(searchParams?: Promise<Query>) {
  const query = searchParams ? await searchParams : {};
  const raw = query.card;
  const cardId = typeof raw === "string" && raw ? raw : null;
  return { cardId };
}

// The page body. The gate throws (redirects to /login or notFound()) before this runs, so a
// successful return is an "ok" verdict from requireTeam.
async function BoardPageBody({ orgSlug, searchParams }: { orgSlug: string; searchParams?: Promise<Query> }) {
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/board`);
  const { cardId } = await readQuery(searchParams);
  // The server-side cookie-bound Supabase client. lib/web-session's `webClient` builds it through
  // @supabase/ssr's createServerClient with the request's cookies and swallows read-only writes —
  // RLS still gates every read, and a memberless visitor just sees nothing.
  const supabase = await webClient();

  // The card list, newest first by updated_at. RLS returns the org's cards only; the visitor
  // sees nothing when they aren't a member of this org.
  const { data: cards, error: cardsError } = await supabase
    .from("cloud_cards")
    .select("*")
    .eq("org_id", ctx.org.id)
    .eq("deleted", false)
    .order("updated_at", { ascending: false })
    .limit(500)
    .overrideTypes<CloudCardRow[]>();
  if (cardsError) {
    // A query that the visitor's RLS denies throws an error here, not an empty list. Treat
    // that the same as "no cards" so a member without cards yet still sees the empty hint.
    if (!isReadDenied(cardsError)) throw cardsError;
  }
  const cardRows: CloudCardRow[] = cards ?? [];

  // The visitor's own commands that haven't become cards (or failed), for the strip under the header.
  const { data: commandRows } = await supabase
    .from("cloud_commands")
    .select("*")
    .eq("org_id", ctx.org.id)
    .eq("created_by", ctx.user.id)
    .in("status", ["pending", "claimed", "failed"])
    .order("created_at", { ascending: true })
    .limit(20)
    .overrideTypes<CloudCommandRow[]>();
  const commands = (commandRows ?? []).filter((c) => isOpenCommand(c) || c.status === "failed");

  // When the page is opened with a ?card=…, fetch its first page of thread items too. The
  // client can reload it after mount for live updates; this is the seed for SSR.
  let threadRows: CloudThreadItemRow[] = [];
  if (cardId) {
    const { data, error } = await supabase
      .from("cloud_thread_items")
      .select("*")
      .eq("org_id", ctx.org.id)
      .eq("card_id", cardId)
      .order("seq", { ascending: false })
      .limit(THREAD_PAGE_SIZE)
      .overrideTypes<CloudThreadItemRow[]>();
    if (!error) threadRows = data;
  }

  // Pre-resolve every blob ref the SSR shell needs. The client can keep the map for the
  // items it receives later through Realtime.
  const initialRefs = new Set<string>();
  if (cardId) collectBlobRefs(pageFromRows(cardId, threadRows).items, initialRefs);
  for (const ref of cardThumbRefs(cardRows)) initialRefs.add(ref);
  const initialBlobUrls = await resolveBlobUrls(supabase, ctx.org.id, [...initialRefs], { onUnmirrored: queueMirror(ctx.org.id) });

  return (
    <WebBoard
      orgId={ctx.org.id}
      orgSlug={orgSlug}
      userId={ctx.user.id}
      user={ctx.user}
      orgs={ctx.orgs}
      initialCommands={commands}
      initialCards={cardRows}
      openCardId={cardId}
      initialThread={threadRows}
      initialBlobUrls={initialBlobUrls}
    />
  );
}

function BoardPageFallback() {
  return <BoardSkeleton />;
}

export default async function Page({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams?: Promise<Query> }) {
  const { orgSlug } = await params;
  if (!isWebEnabled()) return <NotDeployedCard slug={orgSlug} />;
  return (
    <Suspense fallback={<BoardPageFallback />}>
      <BoardPageBody orgSlug={orgSlug} searchParams={searchParams} />
    </Suspense>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Supabase's RLS denial arrives as a `permission denied` (42501) or "row-level security policy"
// error; treat it the same as an empty list so a member of the org with no synced cards still
// sees the empty hint. Anything else (a real 5xx, a network error) is rethrown.
function isReadDenied(err: { code?: string; message?: string }): boolean {
  if (err.code === "42501") return true;
  if (err.message && /row-level security/i.test(err.message)) return true;
  return false;
}

// A tiny re-export so the page file and the components file both see the same import surface
// and the linter doesn't complain about a missing import.
export { BLOB_REF_PREFIX };