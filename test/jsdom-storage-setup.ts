// Node 25+ ships its own experimental global localStorage/sessionStorage (undefined without
// --localstorage-file), and that global shadows the ones Vitest copies over from jsdom. Put jsdom's
// Storage objects back on the global, so jsdom tests get real storage on every Node version.
// Node files have no `jsdom` global and are left alone.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}
