// "Use VERCEL_TOKEN from aimhuge/weft": a provider drawer with no token offers one a project vault already
// holds, so nobody pastes a secret Weft has. Main lists NAMES (candidates) and, on a yes, reads the value
// behind a Touch ID (vault.sendValue) and hands it straight to the provider's own setToken, which validates
// it with the provider and seals it in the Keychain. The value never goes over IPC, into a log or to a thread;
// what comes back is the provider's own status. Slack's bot + app token pair doesn't fit one value: left out.
// Docs: docs/architecture/secrets.md.

// Which vault names may hold each provider's token, most likely first.
const NAMES = {
  vercel: ["VERCEL_TOKEN", "VERCEL_API_TOKEN", "VERCEL_ACCESS_TOKEN"],
  supabase: ["SUPABASE_ACCESS_TOKEN"],
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
};
const ENV_ORDER = ["development", "production"];

/**
 * @param {{ vault: { names(folder: string): Promise<{ label: string, secrets: { name: string, environment: string, missing?: boolean }[] }>,
 *   sendValue(folder: string, name: string, environment: string, reason: (label: string) => string, send: (value: string) => Promise<unknown>): Promise<any> },
 *   providers: Record<string, { setToken(value: string): Promise<unknown> }>, labels?: Record<string, string> }} deps
 */
function createProviderVaultToken({ vault, providers, labels = {} }) {
  const pretty = (provider) => labels[provider] ?? provider[0].toUpperCase() + provider.slice(1);

  // One entry per vault (folders of one repo share a vault): the best name and environment that has a value.
  // Names only, never values.
  async function candidates(provider, folders) {
    const wanted = NAMES[provider];
    if (!wanted || !Array.isArray(folders)) return [];
    const seen = new Set();
    const out = [];
    for (const folder of folders) {
      if (typeof folder !== "string") continue;
      let names;
      try {
        names = await vault.names(folder);
      } catch {
        continue;
      }
      if (seen.has(names.label)) continue;
      seen.add(names.label);
      const has = names.secrets.filter((s) => !s.missing && wanted.includes(s.name) && ENV_ORDER.includes(s.environment));
      has.sort((a, b) => wanted.indexOf(a.name) - wanted.indexOf(b.name) || ENV_ORDER.indexOf(a.environment) - ENV_ORDER.indexOf(b.environment));
      if (has[0])
        out.push({
          folder,
          label: names.label,
          name: has[0].name,
          environment: has[0].environment,
        });
    }
    return out;
  }

  // Touch ID, read, setToken. A no or a missing value changes nothing and says so; a provider's refusal
  // (a bad token) throws its own message, which never carries the value.
  async function adopt(provider, pick) {
    const wanted = NAMES[provider];
    const { folder, name, environment } = pick ?? {};
    if (!wanted || !wanted.includes(name) || !ENV_ORDER.includes(environment) || typeof folder !== "string")
      throw new Error("That isn't a token Weft can use here.");
    let status;
    const result = await vault.sendValue(
      folder,
      name,
      environment,
      (label) => `use ${name} (${label}, ${environment}) as Weft's ${pretty(provider)} token`,
      async (value) => {
        status = await providers[provider].setToken(value);
        return {};
      },
    );
    if (result?.denied) return { denied: true };
    if (result?.missing) return { missing: true };
    return { status };
  }

  return { candidates, adopt };
}

// One provider's IPC handlers, `<provider>:vault-token-candidates` and `<provider>:use-vault-token`, for the board
// window only. Called from each provider's own setup (electron/vercel.cjs, supabase.cjs, cloudflare.cjs); without a
// vault (a test, an old shell) there is no offer.
function wireProviderVaultToken({ ipcMain, vault, board, provider, service }) {
  if (!vault) return null;
  const tokens = createProviderVaultToken({ vault, providers: { [provider]: service } });
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.sender || event.sender !== board()) throw new Error("Vault tokens only go to the board window.");
      return fn(...args);
    });
  handle(`${provider}:vault-token-candidates`, (folders) => tokens.candidates(provider, folders));
  handle(`${provider}:use-vault-token`, (pick) => tokens.adopt(provider, pick));
  return tokens;
}

module.exports = { createProviderVaultToken, wireProviderVaultToken, NAMES };
