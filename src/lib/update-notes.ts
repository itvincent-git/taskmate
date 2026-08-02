import type { Locale } from "./taskmate-i18n";

export function localizeUpdateNotes(notes: string | null | undefined, locale: Locale) {
  if (!notes) return "";
  try {
    const parsed = JSON.parse(notes) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const localized = parsed as Record<string, unknown>;
      const language = locale.startsWith("zh") ? "zh" : "en";
      const value = localized[language] ?? localized.en;
      if (typeof value === "string") return value;
    }
  } catch {
    // GitHub release bodies are plain Markdown rather than localized JSON.
  }
  return notes;
}
