// /admin/settings — the local install's snapshot for the SuperAdmin to eyeball.
// All data is local (no Supabase call), so the page is fully server-rendered.
// Gate: `requireSuperAdminWeft()` throws notFound() for non-admins.
// Built on the admin kit (components/admin).
import type { Metadata } from "next";
import { connection } from "next/server";
import { AdminPage, KeyValues, Section, Stat, StatGrid } from "@/components/admin/kit";
import { loadAdminLocalOverview } from "@/app/api/admin/local/route";
import AdminGate from "../AdminGate";

export const metadata: Metadata = { title: "Weft admin — Settings" };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatMs(n: number) {
  if (n < 60) return `${n}s`;
  if (n < 60 * 60) return `${Math.round(n / 60)}m`;
  return `${Math.round(n / 3600)}h`;
}

export default function AdminSettingsPage() {
  return (
    <AdminGate>
      <Overview />
    </AdminGate>
  );
}

// The overview reads the disk per request, so it renders inside the gate's Suspense.
async function Overview() {
  await connection();
  const data = loadAdminLocalOverview();

  return (
    <AdminPage title="Local Weft install" subtitle="A snapshot of this machine's Weft install, read from disk.">
      <StatGrid>
        <Stat label="Process uptime" value={formatMs(data.uptime)} />
        <Stat label="Cards on board" value={`${data.board.cards}`} />
        <Stat label="Archived cards" value={`${data.board.archived}`} />
        <Stat label="Thread files" value={`${data.board.threads}`} />
        <Stat label="Activity entries" value={`${data.activity.entries}`} />
        <Stat
          label="Last activity"
          value={data.activity.lastAt ? new Date(data.activity.lastAt).toLocaleString() : "—"}
        />
        <Stat label="Stored pages" value={`${data.pages.count} (${formatBytes(data.pages.bytes)})`} />
        <Stat
          label="Keep-alive minutes"
          value={data.settings.maxKeepAliveMinutes === null ? "—" : `${data.settings.maxKeepAliveMinutes}`}
        />
      </StatGrid>

      <Section title="Install">
        <KeyValues
          rows={[
            ["Data dir", data.dataDir],
            ["Weft version", data.version],
          ]}
        />
      </Section>

      <p className="text-[12.5px] text-muted">
        For deeper diagnostics, see <code className="font-mono text-ink">~/.weft/</code> on this machine. Activity
        writes through <code className="font-mono text-ink">~/.weft/activity.jsonl</code>.
      </p>
    </AdminPage>
  );
}
