// Every /admin page renders through this: the super-admin gate inside the page's own <Suspense>.
// The gate reads the session (connection()), which can't be part of the static shell. A boundary in the admin layout
// doesn't help on a tab-to-tab click, since a client navigation only re-renders below the shared layout; so each page
// carries its own, and Next's instant-navigation check passes (node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md).
import { Suspense } from "react";
import { requireSuperAdminWeft } from "@/lib/admin";

async function Gated({ children }: { children: React.ReactNode }) {
  await requireSuperAdminWeft();
  return children;
}

export function AdminLoading() {
  return <p className="px-6 py-6 text-[13px] text-faint">Loading…</p>;
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AdminLoading />}>
      <Gated>{children}</Gated>
    </Suspense>
  );
}
