import { MARKDOWN_ACTIONS, type MarkdownAction } from "../editor/commands";

export type MarkdownShortcutAction = MarkdownAction;
export type EditorShortcuts = Record<MarkdownAction, string | null>;
export type ShortcutPlatform = "mac" | "other";
export type ShortcutValidationError = "invalid" | "duplicate" | "reserved";

export const EDITOR_SHORTCUT_ACTIONS = MARKDOWN_ACTIONS;
export const DEFAULT_EDITOR_SHORTCUTS: EditorShortcuts = {
  h1: null,
  h2: null,
  bold: "Mod+B",
  italic: "Mod+I",
  strike: null,
  inlineCode: null,
  codeBlock: null,
  quote: null,
  bullet: null,
  ordered: null,
  task: "Mod+L",
  link: "Mod+K",
  image: null,
  rule: null,
};

export const EDITOR_SHORTCUTS_STORAGE_KEY = "taskmate-editor-shortcuts.v1";

const modifierOrder = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const modifierKeys = new Set(["Alt", "Control", "Meta", "Shift"]);
const reservedShortcuts = new Set([
  "Mod+A", "Mod+C", "Mod+I", "Mod+V", "Mod+X", "Mod+Y", "Mod+Z", "Mod+Shift+Z",
  "Alt+ArrowUp", "Alt+ArrowDown",
  "Alt+Shift+ArrowUp", "Alt+Shift+ArrowDown", "Mod+Alt+ArrowUp", "Mod+Alt+ArrowDown",
  "Mod+Enter", "Mod+[", "Mod+]", "Mod+Alt+\\", "Mod+Shift+K", "Mod+Shift+\\",
  "Mod+/", "Alt+A", "Mod+Home", "Mod+End", "Mod+Backspace", "Mod+Delete", "Mod+U",
]);
const otherPlatformReservedShortcuts = new Set([
  "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+L", "Mod+M", "Mod+ArrowLeft", "Mod+ArrowRight", "Alt+U",
]);
const macReservedShortcuts = new Set([
  "Ctrl+ArrowLeft", "Ctrl+ArrowRight", "Ctrl+L", "Alt+Shift+M", "Alt+ArrowLeft", "Alt+ArrowRight",
  "Mod+ArrowLeft", "Mod+ArrowRight", "Mod+ArrowUp", "Mod+ArrowDown", "Ctrl+ArrowUp", "Ctrl+ArrowDown",
  "Alt+Backspace", "Alt+Delete", "Ctrl+B", "Ctrl+F", "Ctrl+P", "Ctrl+N", "Ctrl+A", "Ctrl+E",
  "Ctrl+D", "Ctrl+H", "Ctrl+K", "Ctrl+Alt+H", "Ctrl+O", "Ctrl+T", "Ctrl+V", "Mod+Shift+U",
]);

let lastRaw: string | null | undefined;
let lastSnapshot: EditorShortcuts = DEFAULT_EDITOR_SHORTCUTS;
const listeners = new Set<() => void>();

export function getShortcutPlatform(): ShortcutPlatform {
  return navigator.platform.toLowerCase().includes("mac") ? "mac" : "other";
}

export function getEditorShortcuts(): EditorShortcuts {
  const raw = localStorage.getItem(EDITOR_SHORTCUTS_STORAGE_KEY);
  if (raw === lastRaw) return lastSnapshot;
  lastRaw = raw;
  lastSnapshot = parseStoredShortcuts(raw);
  return lastSnapshot;
}

export function subscribeEditorShortcuts(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === EDITOR_SHORTCUTS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setEditorShortcut(action: MarkdownAction, shortcut: string | null) {
  const current = getEditorShortcuts();
  saveEditorShortcuts({ ...current, [action]: shortcut });
}

export function resetEditorShortcuts() {
  localStorage.removeItem(EDITOR_SHORTCUTS_STORAGE_KEY);
  invalidateSnapshot();
}

export function validateShortcut(
  shortcut: string,
  shortcuts: EditorShortcuts,
  action: MarkdownAction,
  platform: ShortcutPlatform = getShortcutPlatform(),
): ShortcutValidationError | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return "invalid";
  if (EDITOR_SHORTCUT_ACTIONS.some((candidate) => candidate !== action && shortcuts[candidate] === normalized)) {
    return "duplicate";
  }
  const platformReserved = platform === "mac" ? macReservedShortcuts : otherPlatformReservedShortcuts;
  if ((reservedShortcuts.has(normalized) || platformReserved.has(normalized)) && DEFAULT_EDITOR_SHORTCUTS[action] !== normalized) return "reserved";
  return null;
}

export function captureShortcut(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> & Partial<Pick<KeyboardEvent, "code">>,
  platform: ShortcutPlatform,
): { type: "cancel" } | { type: "pending" } | { type: "invalid" } | { type: "shortcut"; shortcut: string } {
  if (event.key === "Escape") return { type: "cancel" };
  if (modifierKeys.has(event.key)) return { type: "pending" };
  if (platform === "other" && event.metaKey) return { type: "invalid" };

  const modifiers: string[] = [];
  if (platform === "mac" ? event.metaKey : event.ctrlKey) modifiers.push("Mod");
  if (platform === "mac" && event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.some((modifier) => modifier !== "Shift")) return { type: "invalid" };

  const key = normalizeKey(event.key) ?? normalizeKeyCode(event.code);
  if (!key) return { type: "invalid" };
  return { type: "shortcut", shortcut: [...modifiers, key].join("+") };
}

export function formatShortcut(shortcut: string, platform: ShortcutPlatform) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return shortcut;
  const parts = normalized.split("+");
  if (platform === "mac") {
    const symbols: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
    return parts.map((part) => symbols[part] ?? displayKey(part)).join("");
  }
  return parts.map((part) => part === "Mod" ? "Ctrl" : displayKey(part)).join("+");
}

export function shortcutToCodeMirror(shortcut: string) {
  const parts = normalizeShortcut(shortcut)?.split("+") ?? [];
  const key = parts.pop();
  const codeMirrorKey = key === "Plus" ? "+" : key?.length === 1 ? key.toLowerCase() : key;
  return [...parts, codeMirrorKey].filter(Boolean).join("-");
}

export function shortcutToAria(shortcut: string, platform: ShortcutPlatform) {
  const parts = normalizeShortcut(shortcut)?.split("+") ?? [];
  return parts.map((part) => {
    if (part === "Mod") return platform === "mac" ? "Meta" : "Control";
    if (part === "Ctrl") return "Control";
    return part;
  }).join("+");
}

function parseStoredShortcuts(raw: string | null): EditorShortcuts {
  if (!raw) return DEFAULT_EDITOR_SHORTCUTS;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_EDITOR_SHORTCUTS;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_EDITOR_SHORTCUTS;
  const record = stored as Record<string, unknown>;
  return Object.fromEntries(EDITOR_SHORTCUT_ACTIONS.map((action) => {
    const value = record[action];
    if (value === null) return [action, null];
    return [action, typeof value === "string" ? normalizeShortcut(value) ?? DEFAULT_EDITOR_SHORTCUTS[action] : DEFAULT_EDITOR_SHORTCUTS[action]];
  })) as EditorShortcuts;
}

function saveEditorShortcuts(shortcuts: EditorShortcuts) {
  localStorage.setItem(EDITOR_SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));
  invalidateSnapshot();
}

function invalidateSnapshot() {
  lastRaw = undefined;
  for (const listener of listeners) listener();
}

function normalizeShortcut(shortcut: string) {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const keyPart = parts.at(-1)!;
  const modifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierOrder.find((candidate) => candidate.toLowerCase() === part.toLowerCase());
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  if (!["Mod", "Ctrl", "Alt"].some((modifier) => modifiers.has(modifier))) return null;
  const key = normalizeKey(keyPart);
  if (!key || modifierKeys.has(key)) return null;
  return [...modifierOrder.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function normalizeKey(key: string) {
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  if (/^[`~!@#$%^&*()_\-=[\]{}\\|;:'",.<>/?]$/.test(key)) return key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  const aliases: Record<string, string> = { Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };
  const normalized = aliases[key] ?? key;
  return /^[A-Za-z][A-Za-z0-9]*$/.test(normalized) ? normalized : null;
}

function normalizeKeyCode(code: string | undefined) {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return ({
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  } as Record<string, string>)[code] ?? null;
}

function displayKey(key: string) {
  return ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Plus: "+" } as Record<string, string>)[key] ?? key;
}
