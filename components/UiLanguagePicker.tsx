"use client";

import { setUiLanguage, useUiLanguage, useUiText } from "@/lib/ui-language";

export default function UiLanguagePicker() {
  const language = useUiLanguage();
  const t = useUiText();
  return (
    <select
      aria-label={t("Interface language")}
      title={t("Interface language")}
      value={language}
      onChange={(e) => setUiLanguage(e.target.value === "zh-CN" ? "zh-CN" : "en")}
      className="max-w-full shrink-0 rounded-md border border-line-strong bg-panel px-2 py-1.5 text-[12px] text-ink"
    >
      <option value="en" lang="en">English</option>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
    </select>
  );
}
