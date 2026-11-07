"use client";

import { useSyncExternalStore } from "react";
import { simplifiedChinese } from "./ui-language-zh";

export type UiLanguage = "en" | "zh-CN";

const COOKIE = "weft-ui-language";
const EVENT = "weft-ui-language-change";
const english = () => "en" as const;

function readLanguage(): UiLanguage {
  const saved = /(?:^|;\s*)weft-ui-language=(en|zh-CN)(?:;|$)/.exec(document.cookie)?.[1];
  if (saved === "en" || saved === "zh-CN") return saved;
  return /^zh(?:$|-(?:cn|sg|hans)(?:-|$))/i.test(navigator.language) ? "zh-CN" : "en";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("languagechange", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("languagechange", onChange);
    window.removeEventListener("focus", onChange);
  };
}

export function setUiLanguage(language: UiLanguage) {
  document.cookie = `${COOKIE}=${language}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(subscribe, readLanguage, english);
}

export function uiText(language: UiLanguage, text: string) {
  return language === "zh-CN" && Object.hasOwn(simplifiedChinese, text) ? simplifiedChinese[text] ?? text : text;
}

const translateEnglish = (text: string) => text;
const translateChinese = (text: string) => uiText("zh-CN", text);

export function useUiText() {
  return useUiLanguage() === "zh-CN" ? translateChinese : translateEnglish;
}
