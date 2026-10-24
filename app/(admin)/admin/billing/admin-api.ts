// The admin billing pages' calls to their routes (app/api/admin/billing, app/api/admin/coupons). The admin pages run on
// the local Weft (lib/guard.ts), so every call carries x-weft-token like the Users page does.

const HEADERS = { "content-type": "application/json", "x-weft-token": "1" };

export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: HEADERS });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
}

export async function adminPost<T = unknown>(path: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: HEADERS, body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
}

export function money(cents: number | null | undefined, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format((cents ?? 0) / 100);
}

export function day(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
}

// Shared Tailwind classes, so every admin control looks the same.
export const ui = {
  card: "flex flex-col gap-3 rounded-xl border border-admin-border bg-admin-surface px-4 py-3 text-sm shadow-sm",
  h: "text-[11px] font-medium uppercase tracking-wider text-admin-muted",
  input: "rounded-lg border border-admin-border bg-transparent px-2 py-1 text-sm text-admin-text",
  btn: "rounded-lg border border-admin-border px-2.5 py-1 text-sm text-admin-text transition-colors hover:bg-black/5 disabled:opacity-40",
  danger: "rounded-lg border border-red-400/60 px-2.5 py-1 text-sm text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-40",
  row: "flex flex-wrap items-center gap-2",
};
