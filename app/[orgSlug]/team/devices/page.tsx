// The team's Devices page on weft.zip: every machine the workspace has registered.
//
// The page is a server component. It gates with requireTeam(slug) — the same gate every team page uses —
// and reads the devices through the service client, because the list crosses users: it shows every
// machine in the workspace, whoever owns it, and RLS on `devices` can only show a device to its owner.
//
// The service client stays on the server. What the page hands to its client components is plain data:
// a name, a platform, a last-seen time and a fingerprint. Nothing else.
//
// The page is a list, not a grant flow. Adding a Mac happens in Weft's 🔐 drawer (docs/architecture/teams-vault.md,
// "Joining a shared vault" and "A linked repo shares its vault"): a teammate's Mac asks to join on its own, and an admin
// approves it once for the team there, with the fingerprint check and Touch ID — the drawer is where the vault key is.
// The page's old fingerprint-paste forms (AddDeviceForm, PendingGrantForm) were removed: they wrote a
// `pending_device_grants` row that nothing on either Mac ever finished.
import type { Metadata } from "next";
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { requireTeam } from "@/lib/teams";
import { listOrgVaults, listTeamDevices } from "@/app/api/team/devices/queries";
import { DeviceRow } from "./DeviceRow";
import { TeamTabs } from "./TeamTabs";
import "./devices.css";

export const metadata: Metadata = {
  title: "Devices",
  description: "The machines your workspace can share secrets with.",
};

function NotDeployedCard({ slug }: { slug: string }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Devices · {slug}</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

async function DevicesPageBody({ orgSlug }: { orgSlug: string }) {
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/team/devices`);
  // The service client (ctx.service) does the reads here, on the server: the device list crosses users,
  // so it is scoped by the queries module to the workspace's own members.
  const [devices, vaults] = await Promise.all([listTeamDevices(ctx.service, ctx.org.id, ctx.user.id), listOrgVaults(ctx.service, ctx.org.id)]);
  const live = devices.filter((d) => !d.revokedAt);

  return (
    <div className="wz-teamPage">
      <TeamTabs orgSlug={orgSlug} />
      <header className="wz-teamHeader wz-hero wz-heroGarage">
        <h1 className="wz-teamTitle">Devices</h1>
        <p className="wz-teamSub">
          {live.length} {live.length === 1 ? "machine" : "machines"} can open <strong>{ctx.org.name}</strong>&apos;s shared vaults.
        </p>
      </header>

      <div className="wz-stats">
        <div className="wz-stat">
          <span className="wz-statLabel">Devices</span>
          <span className="wz-statValue">{live.length}</span>
        </div>
        <div className="wz-stat">
          <span className="wz-statLabel">Shared vaults</span>
          <span className="wz-statValue">{vaults.length}</span>
        </div>
      </div>

      <section className="wz-teamSection">
        <h2 className="wz-teamSectionTitle">Machines</h2>
        {devices.length === 0 ? (
          <p className="wz-teamSub">No machine has registered yet. Open a shared vault in Weft and it registers itself.</p>
        ) : (
          <table className="wz-roster wz-deviceTable">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Platform</th>
                <th>Last seen</th>
                <th>Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <DeviceRow key={device.id} device={device} isYou={device.ownerId === ctx.user.id} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="wz-teamSection">
        <h2 className="wz-teamSectionTitle">Adding a machine</h2>
        <p className="wz-teamSub">
          A teammate&apos;s Mac asks to join from Weft&apos;s 🔐 drawer, by itself on a project the team linked. An admin approves it there once, after
          comparing the fingerprint above with the one that Mac shows, and it opens every shared vault of {ctx.org.name}.
        </p>
      </section>

      <footer className="wz-teamFooter">
        A fingerprint identifies a machine, not a person. Share it in person or over a channel you trust — anyone who can read it can confirm a device they control.
      </footer>
    </div>
  );
}

function DevicesPageFallback() {
  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader wz-hero wz-heroGarage">
        <h1 className="wz-teamTitle">Devices</h1>
        <p className="wz-teamSub">Loading the machines…</p>
      </header>
    </div>
  );
}

// The route params are request data under cacheComponents, so they're read inside the <Suspense>, not before it.
async function DevicesPageFor({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  if (!isWebEnabled()) return <NotDeployedCard slug={orgSlug} />;
  return <DevicesPageBody orgSlug={orgSlug} />;
}

export default function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  return (
    <Suspense fallback={<DevicesPageFallback />}>
      <DevicesPageFor params={params} />
    </Suspense>
  );
}
