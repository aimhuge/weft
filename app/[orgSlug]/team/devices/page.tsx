// The team's Devices page on weft.zip: every machine the workspace has registered, and the grants that
// are waiting on a TOFU check.
//
// The page is a server component. It gates with requireTeam(slug) — the same gate every team page uses —
// and reads the devices through the service client, because the list crosses users: it shows every
// machine in the workspace, whoever owns it, and RLS on `devices` can only show a device to its owner.
//
// The service client stays on the server. What the page hands to its client components is plain data:
// a name, a platform, a last-seen time and a fingerprint. Nothing else.
//
// The flow the page supports (docs/architecture/teams-vault.md, "Granting a teammate's devices"):
//
//   1. An admin pastes a device's fingerprint and presses Add. That writes a `pending_device_grants`
//      row and nothing else — no grant, no key.
//   2. The other machine hears about the request, shows the same fingerprint, and the two users compare
//      the strings out of band. That check is the user's job; the UI can't skip it for them.
//   3. The target accepts (app/api/team/devices/accept), which records the device and its public key.
//   4. The granter's Weft seals the vault key to that public key — on the granter's machine, which is
//      the only place the unwrapped key exists (card 8).
import type { Metadata } from "next";
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { requireTeam } from "@/lib/teams";
import { canGrantDevices } from "@/app/api/team/devices/auth";
import { listOrgMembersForGrant, listOrgVaults, listPendingGrants, listTeamDevices } from "@/app/api/team/devices/queries";
import { AddDeviceForm } from "./AddDeviceForm";
import { DeviceRow } from "./DeviceRow";
import { PendingGrantForm } from "./PendingGrantForm";
import { TeamTabs } from "./TeamTabs";
import "./devices.css";

export const metadata: Metadata = {
  title: "Devices",
  description: "The machines your workspace can share secrets with, and the ones waiting to be added.",
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
  const [devices, pending, vaults, members] = await Promise.all([
    listTeamDevices(ctx.service, ctx.org.id, ctx.user.id),
    listPendingGrants(ctx.service, ctx.org.id, ctx.user.id),
    listOrgVaults(ctx.service, ctx.org.id),
    listOrgMembersForGrant(ctx.service, ctx.org.id),
  ]);
  const canGrant = canGrantDevices(ctx);
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
          <span className="wz-statLabel">Waiting</span>
          <span className="wz-statValue">{pending.length}</span>
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

      {pending.length > 0 ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Waiting on a check</h2>
          <p className="wz-teamSub">
            Each request waits until the two machines show the same fingerprint. Read the fingerprint out to the other side, compare, and accept there.
          </p>
          <PendingGrantForm org={orgSlug} grants={pending} viewerId={ctx.user.id} />
        </section>
      ) : null}

      {canGrant ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Add a device</h2>
          {vaults.length === 0 ? (
            <p className="wz-teamSub">This workspace has no shared vault yet. Open a vault in Weft and share it with {ctx.org.name} first.</p>
          ) : null}
          {vaults.length > 0 ? (
            <AddDeviceForm org={orgSlug} vaults={vaults} members={members} viewerId={ctx.user.id} title="Add a teammate&apos;s device" />
          ) : null}
          {vaults.length > 0 ? (
            <AddDeviceForm org={orgSlug} vaults={vaults} members={members} viewerId={ctx.user.id} title="Add this device (another machine of yours)" />
          ) : null}
        </section>
      ) : null}

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
