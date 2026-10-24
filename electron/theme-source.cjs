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

function themeSource(value) {
  return Object.hasOwn(BASES, value) ? BASES[value] : "system";
}

module.exports = { BASES, themeSource };
