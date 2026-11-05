// Vault values typed into a card's pane page for a thread that never sees them (docs/architecture/secrets.md):
// https pages only, after a Touch ID that names the secret and the site (vault.useFor). The field is masked on
// screen, and read_page gets ‹NAME› wherever the value shows up.

/** @param {{ secrets: any, requirePage: any, typeText: any, cdp?: any }} deps */
function createPaneSecrets({ secrets, requirePage, typeText, cdp }) {
  const typed = new Map(); // card key -> Map(value -> name)

  function vault() {
    const v = secrets?.();
    if (!v) throw new Error("The secrets vault isn't ready yet.");
    return v;
  }

  function redact(key, text) {
    let out = String(text);
    for (const [value, name] of typed.get(key) ?? []) out = out.split(value).join(`‹${name}›`);
    return out;
  }

  // thread is the card's title, for the audit log's line (electron/keychain-audit.cjs).
  /** @param {{ key: string, folder: string, name: string, environment?: string, selector: string, thread?: string }} request */
  async function fill({ key, folder, name, environment = "development", selector, thread }) {
    const v = vault();
    const wc = requirePage(key);
    const url = new URL(wc.getURL());
    if (url.protocol !== "https:") throw new Error(`Secrets only go into https pages, and this one is ${url.protocol}//${url.host}${url.pathname}.`);
    const got = await v.useFor(String(folder), String(name), String(environment), { card: key, site: url.host, thread: thread ? String(thread) : undefined });
    if (got.denied || got.missing) return got;
    const { found } = await typeText(cdp, wc, selector, got.value);
    if (!found) return { found, label: got.label };
    await wc.executeJavaScript(`(() => {
      const el = document.activeElement;
      if (el && el.type !== "password") el.style.webkitTextSecurity = "disc";
    })()`);
    if (!typed.has(key)) typed.set(key, new Map());
    typed.get(key).set(got.value, String(name));
    return { found, label: got.label };
  }

  return {
    redact,
    fill,
    list: (folder) => vault().names(String(folder)),
  };
}

module.exports = { createPaneSecrets };
