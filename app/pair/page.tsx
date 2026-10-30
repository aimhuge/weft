// /pair: a browser pairs with your Mac (docs/architecture/mobile-security.md, "Pair a browser"). The link from Settings →
// Sync carries its secret after the #, which never reaches this server; the client component reads it, makes this
// browser's keys and writes the claim, and your Mac checks it and asks Touch ID. A paired browser reads sealed threads
// on the web board; it never approves a tool run. The Weft phone app opens the same link itself.
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isWebEnabled } from "@/lib/home";
import { webUser } from "@/lib/web-session";
import PairBrowser from "@/components/web-board/PairBrowser";
import "@/components/team/team.css";

export const metadata: Metadata = {
  title: "Pair with your Mac · Weft",
  description: "Let this browser read your sealed Weft threads.",
};

async function Body() {
  await connection();
  const user = await webUser();
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Pair this browser with your Mac</h1>
        <PairBrowser user={user ? { id: user.id, name: user.name ?? user.email ?? "" } : null} />
      </main>
    </div>
  );
}

export default function PairPage() {
  if (!isWebEnabled()) notFound();
  return (
    <Suspense>
      <Body />
    </Suspense>
  );
}
