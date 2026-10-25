// Type shim for ./app-secrets-pushed.cjs: what each shared app's keys were when they last went up.

export interface PushedLedger {
  digest(shareId: string, values: Record<string, string>): string;
  settled(appId: string, digest: string): boolean;
  sent(appId: string, digest: string): void;
  declined(appId: string, digest: string): void;
}

export function createPushedLedger(dataDir: string): PushedLedger;
export const LEDGER_FILE: string;
