import { useCallback, useState } from "react";
import type { Language } from "../types";

const LANGUAGE_KEY = "your-app.preferences.v1";

function loadLanguage(): Language {
  try {
    const saved = JSON.parse(localStorage.getItem(LANGUAGE_KEY) ?? "{}") as { language?: unknown };
    if (saved.language === "en" || saved.language === "zh") return saved.language;
  } catch {
    // Ignore invalid data and use the system locale.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function usePreferences() {
  const [language, setLanguageState] = useState<Language>(loadLanguage);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    localStorage.setItem(LANGUAGE_KEY, JSON.stringify({ language: next }));
    document.documentElement.lang = next;
  }, []);
  return { language, setLanguage };
}
