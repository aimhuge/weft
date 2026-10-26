"use client";

import { useCallback, useState } from "react";
import { CUSTOM_PREFIX, customPictureUrl, type CustomTheme } from "@/lib/custom-theme";
import { SCENES, THEMES, type Theme, savedTheme, sceneUrl, setCustomTheme, setTheme } from "@/lib/theme";
import { useCustomThemes } from "@/lib/use-custom-themes";
import Icon, { type IconName } from "./Icon";
import ThemeDescriber, { DescribeTile } from "./ThemeDescriber";

const THEME_ICONS: Record<(typeof THEMES)[number]["id"], IconName> = { system: "monitor", light: "sun", dark: "moon" };

const TILE =
  "relative flex aspect-[4/3] items-end overflow-hidden rounded-md bg-sunken bg-cover bg-[center_70%] p-1.5 text-left outline-none ring-offset-1 ring-offset-panel focus-visible:ring-2 focus-visible:ring-accent";
const tileState = (on: boolean) => (on ? "ring-2 ring-accent" : "opacity-85 hover:opacity-100");

// A prompted theme's tile shows its picture, or a swatch of its colors when it has none.
const customBackground = (t: CustomTheme) =>
  t.picture
    ? `url(${customPictureUrl(t.id)})`
    : `linear-gradient(135deg, ${t.colors.canvas} 0 45%, ${t.colors.card ?? t.colors.canvas} 45% 75%, ${t.colors.accent} 75%)`;

function TileLabel({ children }: { children: string }) {
  return (
    <>
      <span className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent to-60%" />
      <span className="relative text-[11.5px] font-medium leading-tight text-white">{children}</span>
    </>
  );
}

// Settings' Appearance: System, Light or Dark, then a tile per scene, then the themes you prompted
// up and a tile to describe a new one (in words, around your own picture, or both). Every pick applies right away.
export default function AppearancePicker() {
  // Only mounts in the browser, so the cookie is there to read.
  const [theme, setChoice] = useState<Theme>(savedTheme);
  // Open describe box, holding the picture you dropped on its tile (or null for words alone); false when closed.
  const [describing, setDescribing] = useState<File | null | false>(false);
  const choose = (t: Theme) => {
    setTheme(t);
    setChoice(t);
  };
  const chooseCustom = useCallback((t: CustomTheme) => {
    setCustomTheme(t);
    setChoice(`${CUSTOM_PREFIX}${t.id}`);
  }, []);
  // A theme you just described is picked the moment its thread finishes it.
  const { themes, pending, expect } = useCustomThemes(chooseCustom);

  return (
    <div role="radiogroup" aria-label="Appearance" className="flex flex-col gap-2">
      <div className="flex w-fit gap-0.5 rounded-md border border-line-strong p-0.5">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === t.id}
            onClick={() => choose(t.id)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] ${theme === t.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            <Icon name={THEME_ICONS[t.id]} size={13} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {SCENES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={theme === s.id}
            onClick={() => choose(s.id)}
            style={{ backgroundImage: `url(${sceneUrl(s.id)})` }}
            className={`${TILE} ${tileState(theme === s.id)}`}
          >
            <TileLabel>{s.label}</TileLabel>
          </button>
        ))}
        {themes.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === `${CUSTOM_PREFIX}${t.id}`}
            onClick={() => chooseCustom(t)}
            title={t.prompt}
            style={{ backgroundImage: customBackground(t) }}
            className={`${TILE} ${tileState(theme === `${CUSTOM_PREFIX}${t.id}`)}`}
          >
            <TileLabel>{t.label}</TileLabel>
          </button>
        ))}
        {pending.map((id) => (
          <div key={id} title="A thread is painting this theme" className={`${TILE} animate-pulse border border-dashed border-line-strong`}>
            <span className="text-[11px] text-muted">Painting…</span>
          </div>
        ))}
        {describing !== false ? (
          <ThemeDescriber
            initialPicture={describing}
            onClose={() => setDescribing(false)}
            onStarted={(id) => {
              expect(id);
              setDescribing(false);
            }}
          />
        ) : (
          <DescribeTile onOpen={(picture) => setDescribing(picture ?? null)} />
        )}
      </div>
    </div>
  );
}
