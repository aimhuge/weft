import { FIRST_SCENES, SCENES, sceneOf, type Base, type Scene, type SceneId } from "./theme";

// The Settings screen's pages, down the left. Each is one scrolling page of cards; no tabs.
export type SettingsPage = "general" | "laptop" | "models" | "threads" | "security" | "automations" | "shortcuts" | "accounts" | "team" | "sync";

export const SETTINGS_PAGES: { id: SettingsPage; label: string; hint: string }[] = [
  { id: "general", label: "General", hint: "How the board looks and sounds." },
  { id: "laptop", label: "Laptop mode", hint: "Keep your Mac awake with the lid shut, so threads keep running in a bag." },
  { id: "models", label: "Models", hint: "Which CLI and model each kind of work runs on." },
  { id: "threads", label: "Threads", hint: "How new threads start and what they're told." },
  { id: "security", label: "Security", hint: "What threads may do without asking, and how long your sign-ins last." },
  { id: "automations", label: "Automations", hint: "Skills that run on their own." },
  { id: "shortcuts", label: "Shortcuts", hint: "Keys for the board's global actions." },
  { id: "accounts", label: "Accounts", hint: "Your Weft account and the CLIs' logins." },
  { id: "team", label: "Teams", hint: "Every Weft team you're in, and the people in each." },
  { id: "sync", label: "Sync", hint: "Which projects upload their cards to your workspace, and how it's going." },
];

const BY_ID = Object.fromEntries(SETTINGS_PAGES.map((p) => [p.id, p])) as Record<SettingsPage, (typeof SETTINGS_PAGES)[number]>;
export const pageInfo = (id: SettingsPage) => BY_ID[id];

// The settings that wait for Save, so the nav can mark the pages they sit on.
export type PendingEdits = {
  prompt: boolean;
  keepAlive: boolean;
  mode: boolean;
  backend: boolean;
  rules: boolean;
};

export function unsavedPages(p: PendingEdits): Set<SettingsPage> {
  const pages = new Set<SettingsPage>();
  if (p.backend) pages.add("models");
  if (p.prompt || p.keepAlive) pages.add("threads");
  if (p.mode) pages.add("security");
  if (p.rules) pages.add("automations");
  return pages;
}

// The first launch's scenes (Twin Suns over the dark palette, Salt Flats over the light one), by id so
// a new scene in SCENES can't shift them.
const BY_SCENE_ID = Object.fromEntries(SCENES.map((s) => [s.id, s])) as Record<SceneId, Scene>;
const FALLBACK_SCENE: Record<Base, Scene> = { dark: BY_SCENE_ID[FIRST_SCENES.dark], light: BY_SCENE_ID[FIRST_SCENES.light] };

// The picture behind Settings: your scene if you've picked one, else one that suits the light or dark palette.
export function settingsScene(theme: string, base: Base): Scene {
  return sceneOf(theme) ?? FALLBACK_SCENE[base];
}

// The page the screen opens on: the last one you had open this session.
let lastPage: SettingsPage = "general";
export const rememberedPage = () => lastPage;
export function rememberPage(page: SettingsPage) {
  lastPage = page;
}
