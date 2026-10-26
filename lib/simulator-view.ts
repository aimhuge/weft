// What Settings → Connectors → Simulators shows (lib/simulator-status.ts builds it): one row per piece the
// simulator tools need, whether it's there, and what fixes it. Kept apart so the client component imports no
// server code.

// The fixes Weft runs itself when you click Install (lib/simulator-install-steps.ts). Every Android row shares one:
// it fills in whatever of the SDK, adb, the emulator and a virtual device is missing.
export const INSTALL_KEYS = ["axe", "runtime", "xcode-select", "android"] as const;
export type InstallKey = (typeof INSTALL_KEYS)[number];
export type InstallJob = { status: "running" | "done" | "failed"; line: string };

export type SimulatorFix = { text: string; command?: string; url?: string; install?: InstallKey };
export type SimulatorCheck = { key: string; platform: "ios" | "android"; label: string; ok: boolean; detail: string; fix?: SimulatorFix };
export type SimulatorStatus = { checks: SimulatorCheck[]; devices: number };
