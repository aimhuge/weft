// What a host does for lib/tunnels.ts (docs/architecture/tunnels.md): who says yes to a tunnel and who writes its row.
// The Mac asks its own Touch ID and writes as the signed-in owner (lib/tunnel-mac.ts); a worker asks its owner's Mac
// and writes through its key-checked functions (lib/tunnel-worker.ts). The gate and cloudflared are the same on both.

export interface TunnelRecord {
  id: string;
  folder: string;
  name: string;
  target: string;
}

export interface TunnelHost {
  // Throws when this host can't open one at all (signed out; a worker with no line to its Mac).
  ready(): Promise<void>;
  // Weft's own port, which a tunnel must never reach.
  weftPort(): number | undefined;
  // A person's yes for this record, or a throw. `until` is when that yes runs out, when the approver says.
  approve(record: TunnelRecord, hours: number, cardId: string | undefined): Promise<{ until?: number }>;
  publish(id: string, open: { url: string; secret: string; expiresAt: number }): Promise<void>;
  unpublish(id: string): Promise<void>;
  // Points the relays of this server at the tunnel (or back), so a provider gets the route's real answer.
  linkRelays(target: string, tunnelId: string | null): Promise<void>;
}

export const NO_TOUCH_ID = "Weft didn't get your Touch ID, so no tunnel was opened.";
