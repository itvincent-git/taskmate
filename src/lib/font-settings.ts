export type FontTarget = "interface" | "editor";

export interface FontSettings {
  interface: string | null;
  editor: string | null;
}

export const FONT_SETTINGS_STORAGE_KEY = "taskmate-fonts.v1";

const defaults: FontSettings = { interface: null, editor: null };
const listeners = new Set<() => void>();
let settings = loadFontSettings();

applyFontSettings(settings);

export function getFontSettings(): FontSettings {
  return settings;
}

export function subscribeFontSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFont(target: FontTarget, font: string | null) {
  settings = { ...settings, [target]: font?.trim() || null };
  localStorage.setItem(FONT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  applyFontSettings(settings);
  listeners.forEach((listener) => listener());
}

function loadFontSettings(): FontSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(FONT_SETTINGS_STORAGE_KEY) || "null") as Partial<FontSettings> | null;
    return {
      interface: typeof stored?.interface === "string" ? stored.interface : null,
      editor: typeof stored?.editor === "string" ? stored.editor : null,
    };
  } catch {
    return defaults;
  }
}

function applyFontSettings(value: FontSettings) {
  const root = document.documentElement.style;
  setCssFont(root, "--font-interface-custom", value.interface);
  setCssFont(root, "--font-editor-custom", value.editor);
}

function setCssFont(style: CSSStyleDeclaration, property: string, font: string | null) {
  if (!font) {
    style.removeProperty(property);
    return;
  }
  style.setProperty(property, `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
}
