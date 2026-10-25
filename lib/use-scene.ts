"use client";

// The board's current scene (one of Weft's pictures behind the board), watched through a
// MutationObserver so a pick in Appearance while Settings is open is reflected right away.
import { useEffect, useState } from "react";
import { SCRIM } from "./settings-shared";
import { settingsScene, type SettingsPage } from "./settings-nav";
import { sceneUrl, type Base, type Scene } from "./theme";

export function currentSceneFromDOM(): Scene {
  const root = document.documentElement;
  return settingsScene(root.dataset.scene ?? "", root.dataset.theme === "dark" ? "dark" : "light");
}

export function useScene(): Scene {
  const [scene, setScene] = useState(currentSceneFromDOM);
  useEffect(() => {
    const watch = new MutationObserver(() => setScene(currentSceneFromDOM()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene", "data-theme"] });
    return () => watch.disconnect();
  }, []);
  return scene;
}

// The background behind Settings. A theme you prompted up has no built-in scene, so it paints from the
// --scene and --scene-pos applyTheme put on <html>; every other pick paints its scene's picture.
export function settingsBackdrop(): string {
  const root = document.documentElement;
  const scene = currentSceneFromDOM();
  const picture =
    root.dataset.scene === "custom" ? "var(--scene) var(--scene-pos, center 62%)" : `url(${sceneUrl(scene.id)}) center 62%`;
  return `${SCRIM[scene.base]}, ${picture} / cover no-repeat, var(--canvas)`;
}

// settingsBackdrop, kept current as the theme changes (a custom pick sets its properties along with data-scene).
export function useSettingsBackdrop(): string {
  const [backdrop, setBackdrop] = useState(settingsBackdrop);
  useEffect(() => {
    const watch = new MutationObserver(() => setBackdrop(settingsBackdrop()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene", "data-theme", "style"] });
    return () => watch.disconnect();
  }, []);
  return backdrop;
}

// re-export so consumers don't need both files.
export type { SettingsPage };
export type { Base, Scene };
