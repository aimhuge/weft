"use client";

import { appEditTarget } from "@/lib/app-edit";
import type { MiniApp } from "@/lib/mini-apps";
import { requestNewThread } from "@/lib/new-thread-request";
import Icon from "./Icon";

// The browser pane's Edit button for a saved app that's a local page (components/BrowserPane.tsx, beside Share): opens
// the New thread dialog on the app's folder with a draft naming the app (lib/app-edit.ts). Nothing for a web app.
export default function AppEditButton({ app }: { app: MiniApp | undefined }) {
  const target = app ? appEditTarget(app) : null;
  if (!app || !target) return null;
  return (
    <button
      type="button"
      title={`Edit ${app.name} in a new thread`}
      aria-label="Edit app"
      onClick={() => requestNewThread(target)}
      className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
    >
      <Icon name="pencil" size={15} />
    </button>
  );
}
