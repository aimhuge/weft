"use client";

// The tab strip above the workspace's people and machines: Team (the roster) and Devices (the machines).
// It reads the current path so the tab you're on is marked, which is why it's a client component.
//
// The two pages are siblings under /[orgSlug]/team, so the strip is a pair of links rather than a
// router — the browser does the navigation, and each page is its own server render.

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TeamTabs({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();
  const onDevices = pathname.includes("/team/devices");
  return (
    <nav className="wz-teamTabs" aria-label="Team sections">
      <Link className="wz-teamTab" href={`/${orgSlug}/team`} aria-current={onDevices ? undefined : "page"}>
        People
      </Link>
      <Link className="wz-teamTab" href={`/${orgSlug}/team/devices`} aria-current={onDevices ? "page" : undefined}>
        Devices
      </Link>
    </nav>
  );
}
