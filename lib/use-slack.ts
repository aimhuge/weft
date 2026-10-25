"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api-client";
import { slackBridge } from "./slack-view";
import { DEFAULT_SLACK_SETTINGS, type SlackChannel, type SlackSettings, type SlackSettingsPatch, type SlackStatus } from "./slack-types";

// The rail's Slack drawer (components/SlackDrawer.tsx): what Electron main's Slack side says (the
// tokens, the workspace, the Socket Mode connection) and what the server decides to post (the channel,
// the events, the folder a card from Slack runs in). The tokens never reach the board: main keeps them
// in the Keychain and makes every call.

export interface SlackAnswer {
  settings: SlackSettings;
  folderSynced: boolean;
  // The default and mapped projects that sync to weft.zip.
  synced: string[];
}

// The settings live on the server; without it (a browser tab) the drawer has nothing to show.
async function readSettings(): Promise<SlackAnswer> {
  const res = await apiFetch("/api/slack");
  if (!res.ok) throw new Error(await errorText(res, "Slack's settings couldn't be read."));
  const data = (await res.json()) as Partial<SlackAnswer> & { settings?: Partial<SlackSettings> };
  return {
    settings: { ...DEFAULT_SLACK_SETTINGS, ...data.settings, events: { ...DEFAULT_SLACK_SETTINGS.events, ...data.settings?.events } },
    folderSynced: data.folderSynced === true,
    synced: Array.isArray(data.synced) ? data.synced : [],
  };
}

export function useSlack(active: boolean) {
  const bridge = slackBridge();
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [settings, setSettings] = useState<SlackSettings | null>(null);
  const [folderSynced, setFolderSynced] = useState(false);
  const [synced, setSynced] = useState<string[]>([]);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The newest load wins: an old answer that lands after a newer one is dropped.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const [st, answer] = await Promise.all([bridge ? bridge.status() : Promise.resolve(null), readSettings()]);
      if (mine !== latest.current) return;
      setStatus(st);
      setSettings(answer.settings);
      setFolderSynced(answer.folderSynced);
      setSynced(answer.synced);
      setError(null);
    } catch (err) {
      if (mine === latest.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [bridge]);

  // Loads once when the drawer first opens, and again whenever it's open and the window comes back.
  useEffect(() => {
    if (!active) return;
    const load = () => void refresh();
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [active, refresh]);

  const connect = useCallback(
    async (bot: string, app: string) => {
      setLoading(true);
      try {
        const st = bridge ? await bridge.setTokens(bot, app) : null;
        setStatus(st);
        setError(null);
        await refresh();
        return st;
      } finally {
        setLoading(false);
      }
    },
    [bridge, refresh],
  );

  const disconnect = useCallback(async () => {
    setLoading(true);
    try {
      const st = bridge ? await bridge.forgetToken() : null;
      setStatus(st);
      setError(null);
      await refresh();
      return st;
    } finally {
      setLoading(false);
    }
  }, [bridge, refresh]);

  // The picker's channels. A failure (no channels:read scope, a token Slack turned down) is kept to show beside the
  // picker, not thrown away: an empty list with no reason looks like a drawer that doesn't work.
  const loadChannels = useCallback(async () => {
    if (!bridge) return [];
    try {
      const list = await bridge.channels();
      setChannels(list);
      setChannelsError(null);
      return list;
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, [bridge]);

  // A new public channel from the picker: it goes to the top of the list at once, ready to be picked.
  const createChannel = useCallback(
    async (name: string) => {
      if (!bridge) throw new Error("Slack connects in Weft's desktop app.");
      // A shell started before this feature has no createChannel on its bridge until Weft restarts.
      if (typeof bridge.createChannel !== "function") throw new Error("Restart Weft to create channels from here.");
      const made = await bridge.createChannel(name);
      setChannels((list) => [made, ...list.filter((c) => c.id !== made.id)]);
      return made;
    },
    [bridge],
  );

  // A patch of the settings: the channel, the folder, or which events to post.
  // It shows at once (a "post about" box ticks the moment you click it); a refusal puts the old settings back.
  const save = useCallback(async (patch: SlackSettingsPatch) => {
    let before: SlackSettings | null = null;
    setSettings((s) => {
      before = s;
      if (!s) return s;
      // A route's null clears that kind's row, so the merge keeps the old row out of the new one.
      const routes: SlackSettings["routes"] = {};
      for (const [key, row] of Object.entries(s.routes)) {
        routes[key as keyof typeof routes] = row;
      }
      for (const [key, row] of Object.entries(patch.routes ?? {})) {
        const kind = key as keyof typeof routes;
        if (row === null) {
          const kept: SlackSettings["routes"] = {};
          for (const [name, value] of Object.entries(routes)) {
            if (name !== key) kept[name as keyof typeof kept] = value;
          }
          Object.assign(routes, kept);
          continue;
        }
        routes[kind] = row;
      }
      return { ...s, ...patch, events: { ...s.events, ...patch.events }, routes };
    });
    const res = await apiFetch("/api/slack", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch((err: unknown) => {
      setSettings(before);
      throw err;
    });
    if (!res.ok) {
      setSettings(before);
      throw new Error(await errorText(res, "Slack's settings couldn't be saved."));
    }
    const data = (await res.json()) as Partial<SlackAnswer> & { settings?: Partial<SlackSettings> };
    // The server's answer may leave a field out; the drawer reads them all.
    const answer: SlackAnswer = {
      settings: { ...DEFAULT_SLACK_SETTINGS, ...data.settings, events: { ...DEFAULT_SLACK_SETTINGS.events, ...data.settings?.events } },
      folderSynced: data.folderSynced === true,
      synced: Array.isArray(data.synced) ? data.synced : [],
    };
    setSettings(answer.settings);
    setFolderSynced(answer.folderSynced);
    setSynced(answer.synced);
    return answer;
  }, []);

  const test = useCallback(async () => {
    const res = await apiFetch("/api/slack/test", { method: "POST" });
    if (!res.ok) throw new Error(await errorText(res, "The test message couldn't be sent."));
    return (await res.json()) as { ok?: boolean; text?: string };
  }, []);

  // Turns the folder's weft.zip sync on, so a card started from Slack has a link to open.
  const syncFolder = useCallback(
    async (folder: string) => {
      const res = await apiFetch("/api/cloud-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder, on: true }),
      });
      if (!res.ok) throw new Error(await errorText(res, "The folder's sync couldn't be turned on."));
      await refresh();
      return true;
    },
    [refresh],
  );

  // With no bridge (a browser tab) there's no Slack side to talk to.
  const note = !bridge ? "Slack connects in Weft's desktop app, where Electron keeps your tokens." : null;

  return { bridge, status, settings, folderSynced, synced, channels, channelsError, loading, error, note, refresh, connect, disconnect, loadChannels, createChannel, save, test, syncFolder };
}

// The server's own words when it refuses, or a plain one.
async function errorText(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}
