// The 🔐 drawer's one status line under a vault's name (docs/architecture/secrets.md, "The drawer and Settings →
// Secrets"): where the vault stands with the team, and the next step, which Settings → Secrets takes. One line instead
// of the badge, the share button, the join banner, the asks and the why-no-join hint the drawer used to stack.
import { DEVICE_HINTS, JOIN_HINTS } from "./vault-shared";
import type { VaultSummary } from "./vault-view";

export type VaultStatus = { text: string; action: string | null; tone: "quiet" | "accent" };

// A removed or unregistered Mac can't act on anything vaultStatus says, so its standing comes first.
function deviceStatus(hint: VaultSummary["joinHint"]): VaultStatus | null {
  const action = hint && DEVICE_HINTS[hint];
  return hint && action ? { text: JOIN_HINTS[hint], action, tone: "accent" } : null;
}

// Where this Mac is in joining a vault its team shares.
function joinStatus(join: NonNullable<VaultSummary["join"]>): VaultStatus {
  if (join.state === "asked") return { text: "Waiting for an admin to approve this Mac", action: "Details", tone: "quiet" };
  if (join.state === "granted") return { text: "An admin approved this Mac", action: "Open shared vault", tone: "accent" };
  return { text: "Your team shares this vault; this Mac isn't in it", action: "Ask to join", tone: "accent" };
}

// Whether Settings → Secrets offers Share… for this vault: a local one, on a Mac that may share.
export function offersShare(v: VaultSummary): boolean {
  return !v.shared && !v.join && !deviceStatus(v.joinHint);
}

export function vaultStatus(v: VaultSummary): VaultStatus | null {
  const device = deviceStatus(v.joinHint);
  if (device) return device;
  const asking = v.requests?.length ?? 0;
  if (asking) return { text: `${asking} ${asking === 1 ? "Mac asks" : "Macs ask"} to join`, action: "Review", tone: "accent" };
  if (v.join) return joinStatus(v.join);
  if (v.shared) return { text: `Shared with ${v.shared.org.name || "a workspace"} · key v${v.shared.keyVersion}`, action: null, tone: "quiet" };
  if (v.joinHint) return { text: JOIN_HINTS[v.joinHint], action: v.joinHint === "signed-out" ? "Sign in" : null, tone: "quiet" };
  if (v.id.startsWith("github:") && v.secrets.some((s) => !s.missing)) return { text: "On this Mac only", action: "Share…", tone: "quiet" };
  return null;
}
