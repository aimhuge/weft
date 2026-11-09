import { vi } from "vitest";
import { createVercelEnv } from "./vercel-env.cjs";

// A Vercel env over a fake vault and a fake Vercel API, for electron/vercel-env*.test.ts.

type Env = { id?: string | null; key: string; targets: string[]; type?: string | null };

export function make(envs: Env[] = [], values: Record<string, string | null> = {}, pushable: Record<string, Record<string, string>> = {}) {
  const vault = {
    names: vi.fn(() =>
      Promise.resolve({
        label: "aimhuge/weft",
        secrets: [
          { name: "KEY", environment: "production", missing: false },
          { name: "KEY", environment: "development", missing: false },
          { name: "TODO", environment: "production", missing: true },
        ],
      }),
    ),
    sendValue: vi.fn((_folder: string, _name: string, _env: string, reason: (label: string) => string, send: (value: string) => Promise<unknown>) =>
      send(`value-for-${reason("aimhuge/weft")}`).then((r) => ({ ...(r as object), label: "aimhuge/weft" })),
    ),
    valuesFor: vi.fn((_folder: string, _names: null, environment: string) => Promise.resolve({ label: "aimhuge/weft", values: pushable[environment] ?? {} })),
    confirm: vi.fn(() => Promise.resolve(true)),
    setValue: vi.fn(() => Promise.resolve({ saved: true })),
  };
  const vercel = {
    envList: vi.fn(() => Promise.resolve({ project: "weft", envs })),
    envSet: vi.fn(() => Promise.resolve({ pushed: true, project: "weft" })),
    envValue: vi.fn((_folder: string, id: string) => Promise.resolve(values[id] ?? null)),
    createWebhook: vi.fn(() => Promise.resolve({ id: "hook_1", secret: "s" })),
    deleteWebhook: vi.fn(() => Promise.resolve({ removed: true })),
  };
  return { env: createVercelEnv({ vercel, vault }), vault, vercel };
}

