// What nativeTheme should follow for the board's Appearance cookie (lib/theme.ts): a scene follows
// its own base palette, anything unknown follows the system. Keep in step with SCENES there
// (electron/theme-source.test.ts checks).
const BASES = {
  light: "light",
  dark: "dark",
  "twin-suns": "dark",
  canyon: "dark",
  "coast-road": "dark",
  "neon-city": "dark",
  "snow-pass": "dark",
  cockpit: "dark",
  "night-cockpit": "dark",
  "salt-flats": "light",
};

// A theme you prompted up ("custom-<id>") keeps its base in its own cookie, weft-custom-theme
// (lib/custom-theme.ts), beside its palette; a stale or missing one follows the system.
const CUSTOM_COOKIE = "weft-custom-theme";

function customBase(value, custom) {
  try {
    const saved = JSON.parse(decodeURIComponent(custom || ""));
    return `custom-${saved.id}` === value && (saved.base === "light" || saved.base === "dark") ? saved.base : "system";
  } catch {
    return "system";
  }
}

function themeSource(value, custom) {
  if (typeof value === "string" && value.startsWith("custom-")) return customBase(value, custom);
  return Object.hasOwn(BASES, value) ? BASES[value] : "system";
}

// The board keeps the user's Appearance choice in a cookie (lib/theme.ts). Following it gives the
// window background, menus and the startup screen the same theme as the board.
const THEME_COOKIE = "weft-theme";

async function syncThemeSource(cookies, nativeTheme) {
  const [saved] = await cookies.get({ name: THEME_COOKIE }).catch(() => []);
  const [custom] = await cookies.get({ name: CUSTOM_COOKIE }).catch(() => []);
  nativeTheme.themeSource = themeSource(saved?.value, custom?.value);
}

async function followThemeChoice(cookies, nativeTheme) {
  await syncThemeSource(cookies, nativeTheme);
  cookies.on("changed", (_event, cookie, cause, removed) => {
    // Rewriting a cookie first reports the old value as removed; wait for the new one.
    if (![THEME_COOKIE, CUSTOM_COOKIE].includes(cookie.name) || (removed && cause === "overwrite")) return;
    void syncThemeSource(cookies, nativeTheme);
  });
}

module.exports = { BASES, CUSTOM_COOKIE, followThemeChoice, themeSource };
