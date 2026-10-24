// The /@<user>/apps/<slug> and /<org>/apps/<slug> viewer: one shared mini app, its page
// full-window under a thin header. A page the Mac uploaded is framed from /api/a/<id>/page/<sha>,
// sandboxed by the route's CSP; a public site is framed at its address, with Open for the sites
// that refuse to be framed; a folder's entry is framed from /api/a/<id>/v/<ver>/<entry> (lib/app-share-frame.ts).
//
// The host page also runs the parent side of the bridge (lib/app-bridge.ts): the inline script
// Weft inserts into the app's HTML posts a BridgeRequest to window.parent, the page calls one of
// Weft's /api/a/<id>/{fetch,read,env} routes (or pops AppSecretForm for requestSecret) and posts
// a BridgeResponse back. See use-app-bridge.ts and lib/app-bridge-inject.ts.
//
// The secret form is this component's own state, never a prop: the page is a server component, and a
// function can't cross that boundary (passing one crashed every /@<user>/apps/<slug> page on 2026-10-23).
"use client";

import { useRef, useState } from "react";
import { appGlyph } from "@/lib/mini-apps";
import type { AppPolicy } from "@/lib/app-share-types";
import AppSecretForm, { type AppSecretFormProps } from "./AppSecretForm";
import { PaneFrame } from "./PaneFrame";
import { useAppBridge, type AppSecretSpec } from "./use-app-bridge";
import "./share-view.css";

export function SharedApp({
  name,
  src,
  site,
  shareId,
  manifest,
}: {
  name: string;
  src: string;
  // A public site is framed as is (the user gets Open to bypass sites that refuse to be framed).
  site: boolean;
  // The app's share id, used to build the route paths the bridge posts to. The legacy /a/<id>
  // viewer still passes it; only the canonical /@<user>/apps/<slug> viewer wires the bridge.
  shareId?: string;
  // The folder app's policy, with the secret declarations. Empty for a site or single-page app.
  manifest?: AppPolicy | null;
}) {
  const glyph = appGlyph(name);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The secret the app asked for with weft.requestSecret, while its form is open.
  const [asking, setAsking] = useState<AppSecretFormProps | null>(null);
  const secrets: AppSecretSpec[] = manifest?.secrets
    ? Object.entries(manifest.secrets).map(([n, rule]) => ({ name: n, hosts: rule.hosts }))
    : [];
  // The hook is called unconditionally; it no-ops when shareId is empty (the legacy /a/<id>
  // viewer), so the call order is stable across renders.
  useAppBridge(iframeRef, {
    shareId: shareId ?? "",
    secrets,
    renderSecretForm: (input) =>
      setAsking({
        ...input,
        onDone: (set) => {
          setAsking(null);
          input.onDone(set);
        },
      }),
  });
  return (
    <div className="wz-desk" data-theme="dark">
      <div className="wz-share">
        <header className="wz-shareHeader">
          <h1 className="wz-shareTitle">
            <span
              aria-hidden
              className="wz-shareAppGlyph"
              data-emoji={glyph.emoji ? "true" : "false"}
              style={glyph.emoji ? undefined : { background: `hsl(${glyph.hue} 55% 48%)` }}
            >
              {glyph.text}
            </span>
            <span>{name}</span>
          </h1>
          <span className="wz-shareColumn">Mini app</span>
          <div className="flex-1" />
          {site && (
            <a href={src} target="_blank" rel="noopener noreferrer" className="wz-shareBrand" style={{ marginLeft: 0 }}>
              Open ↗
            </a>
          )}
          <a className="wz-shareBrand" href="https://weft.zip" target="_blank" rel="noopener noreferrer">
            Shared from Weft
          </a>
        </header>
        <PaneFrame
          frameRef={iframeRef}
          title={name}
          src={src}
          sandbox="allow-scripts allow-popups allow-forms"
          {...(site ? { openHref: src } : {})}
        />
      </div>
      {asking && <AppSecretForm {...asking} />}
    </div>
  );
}

