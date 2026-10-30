"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";

// The board folders' open tunnels (GET /api/tunnels), read every POLL_MS while the 🪝 drawer is open, so one a thread
// opened or one that expired shows up. open and close throw, for the drawer to show.
export const POLL_MS = 5000;

export interface TunnelView {
  id: string;
  folder: string;
  name: string;
  target: string;
  address: string;
  expiresAt: number;
}

async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Tunnels: ${res.status}`);
  return body;
}

export function useTunnels(folders: string[]) {
  const [tunnels, setTunnels] = useState<TunnelView[]>([]);
  const key = folders.join("\n");

  const reload = useCallback(async () => {
    const query = key.split("\n").map((f) => `folder=${encodeURIComponent(f)}`).join("&");
    const { tunnels: list } = await answer<{ tunnels: TunnelView[] }>(await apiFetch(`/api/tunnels?${query}`));
    setTunnels(list);
  }, [key]);

  useEffect(() => {
    const load = () => void reload().catch(() => {});
    load();
    const poll = setInterval(load, POLL_MS);
    return () => clearInterval(poll);
  }, [reload]);

  const open = async (folder: string, target: string) => {
    await answer(await apiFetch("/api/tunnels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder, target }) }));
    await reload();
  };
  const close = async (id: string) => {
    await answer(await apiFetch(`/api/tunnels?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
    await reload();
  };

  return { tunnels, open, close };
}
