// The parent side of the hosted-app bridge (lib/app-bridge.ts, docs/architecture/mini-app-hosting.md).
// The frame's inline script posts a BridgeRequest to the parent, the parent calls one of Weft's
// /api/a/<id>/{fetch,read,env} routes (or pops the secret form) and posts a BridgeResponse back.
// The frame's origin is opaque (the route's CSP is sandbox without allow-same-origin), so the
// parent always uses "*" as the targetOrigin on the way back. The way in is strict: only
// messages with event.source === the iframe's contentWindow and a parsed BridgeRequest are
// answered, so a malicious page can't open another tab and post fake requests at us.
"use client";

import { useEffect, useRef } from "react";
import { parseBridgeRequest, type BridgeResponse } from "@/lib/app-bridge";

export interface AppSecretSpec {
  // One secret from the manifest: its name and the hosts it may go to. The parent shows the form
  // when the app calls requestSecret(name); the form lists the hosts the value is allowed to
  // reach so the user knows where it can be sent.
  name: string;
  hosts: string[];
}

export interface UseAppBridgeOptions {
  // The app's share id (the route name the parent posts to).
  shareId: string;
  // The secrets the manifest declares; used by requestSecret to render AppSecretForm with the
  // host list. Empty when the manifest has no secrets.
  secrets: AppSecretSpec[];
  // The form renderer: a portal over the frame, called with the secret's metadata and an
  // `onDone` that resolves the bridge call. The parent page passes the real AppSecretForm
  // (built by the secrets-route agent), the tests pass a stub.
  renderSecretForm: (input: { shareId: string; name: string; hosts: string[]; onDone: (set: boolean) => void }) => void;
}

export function useAppBridge(iframeRef: React.RefObject<HTMLIFrameElement | null>, opts: UseAppBridgeOptions): void {
  // No share id: nothing to wire. The legacy /a/<id> viewer mounts SharedApp without a shareId
  // and the requestSecret form wouldn't render anyway, so the listener is a no-op.
  const enabled = Boolean(opts.shareId);
  // The latest opts, kept in a ref so the message listener can read fresh values without
  // re-binding on every render. Updated in a layout effect (below), never during render.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      // event.source check: the only window we listen to is the iframe we drew. Anything else
      // (a popup, a parent page's own window) is dropped, even if the data parses. Read from
      // iframeRef at message time, not a captured value: React sets the ref after this effect ran,
      // and after a navigation the frame's contentWindow is a fresh Window. Both cases work
      // because the comparison and the response target read through iframeRef.current each time.
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const request = parseBridgeRequest(event.data);
      if (!request) return;
      const respond = (payload: BridgeResponse) => {
        frame.contentWindow?.postMessage(payload, "*");
      };
      const { shareId, secrets, renderSecretForm } = optsRef.current;
      // Each op is its own promise; respond as it settles. Errors become { ok: false, error }.
      const handle = <T,>(id: number, p: Promise<T>) => {
        p.then(
          (result) => respond({ tag: BRIDGE_TAG_LITERAL, id, ok: true, result }),
          (err: unknown) => respond({ tag: BRIDGE_TAG_LITERAL, id, ok: false, error: errorMessage(err) }),
        );
      };
      switch (request.op) {
        case "fetch": {
          const { id, ...rest } = request;
          handle(id, callFetch(shareId, rest));
          return;
        }
        case "read": {
          const { id, name, args } = request;
          handle(id, callRead(shareId, name, args));
          return;
        }
        case "env": {
          handle(request.id, callEnv(shareId));
          return;
        }
        case "requestSecret": {
          const { id, name } = request;
          handle(id, callRequestSecret(shareId, name, secrets, renderSecretForm));
          return;
        }
        case "access": {
          handle(request.id, callAccess(shareId));
          return;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // The ref is stable; opts.shareId changes only on navigation, which unmounts the component.
  }, [iframeRef, opts.shareId, enabled]);
}

// The literal tag used in responses. Imported at module load, but inlined here so the
// switch statement's response type is the same value the parent's parseBridgeRequest checked.
const BRIDGE_TAG_LITERAL = "weft-app-bridge/1" as const;

async function callFetch(
  shareId: string,
  req: { url: string; method: string; headers: Record<string, string>; body?: string },
): Promise<unknown> {
  const res = await fetch(`/api/a/${shareId}/fetch`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const error = await safeError(res);
    throw new Error(error || `fetch ${res.status}`);
  }
  return res.json();
}

async function callRead(shareId: string, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`/api/a/${shareId}/read`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  if (!res.ok) {
    const error = await safeError(res);
    throw new Error(error || `read ${res.status}`);
  }
  return res.json();
}

// GET /api/a/<id>/access: { project, env, needs, missing, granted }, the Mac's data-app access() shape.
async function callAccess(shareId: string): Promise<unknown> {
  const res = await fetch(`/api/a/${shareId}/access`, { credentials: "same-origin" });
  if (!res.ok) {
    const error = await safeError(res);
    throw new Error(error || `access ${res.status}`);
  }
  return res.json();
}

async function callEnv(shareId: string): Promise<unknown> {
  const res = await fetch(`/api/a/${shareId}/env`, { credentials: "same-origin" });
  if (!res.ok) {
    const error = await safeError(res);
    throw new Error(error || `env ${res.status}`);
  }
  return res.json();
}

function callRequestSecret(
  shareId: string,
  name: string,
  secrets: AppSecretSpec[],
  renderSecretForm: UseAppBridgeOptions["renderSecretForm"],
): Promise<{ set: boolean }> {
  return new Promise<{ set: boolean }>((resolve) => {
    const spec = secrets.find((s) => s.name === name);
    const hosts = spec ? spec.hosts : [];
    renderSecretForm({
      shareId,
      name,
      hosts,
      onDone: (set) => resolve({ set }),
    });
  });
}

async function safeError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string") return data.error;
  } catch {
    // fall through
  }
  return "";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
