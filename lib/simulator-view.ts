// What Settings → Connectors → Simulators shows (lib/simulator-status.ts builds it): one row per piece the
// simulator tools need, whether it's there, and the command or link that fixes it. Kept apart so the client
// component imports no server code.
export type SimulatorFix = { text: string; command?: string; url?: string };
export type SimulatorCheck = { key: string; platform: "ios" | "android"; label: string; ok: boolean; detail: string; fix?: SimulatorFix };
export type SimulatorStatus = { checks: SimulatorCheck[]; devices: number };
