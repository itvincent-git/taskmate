import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EDITOR_SHORTCUTS,
  EDITOR_SHORTCUT_ACTIONS,
  EDITOR_SHORTCUTS_STORAGE_KEY,
  captureShortcut,
  formatShortcut,
  getEditorShortcuts,
  resetEditorShortcuts,
  setEditorShortcut,
  shortcutToAria,
  shortcutToCodeMirror,
  validateShortcut,
} from "./editor-shortcuts";

beforeEach(() => localStorage.clear());

describe("editor shortcuts", () => {
  it("defines all toolbar actions with only the Obsidian defaults assigned", () => {
    expect(EDITOR_SHORTCUT_ACTIONS).toHaveLength(14);
    expect(Object.keys(DEFAULT_EDITOR_SHORTCUTS)).toEqual([...EDITOR_SHORTCUT_ACTIONS]);
    expect(Object.entries(DEFAULT_EDITOR_SHORTCUTS).filter(([, shortcut]) => shortcut !== null)).toEqual([
      ["bold", "Mod+B"],
      ["italic", "Mod+I"],
      ["task", "Mod+L"],
      ["link", "Mod+K"],
    ]);
  });

  it("loads defaults and falls back per damaged field", () => {
    expect(getEditorShortcuts()).toEqual(DEFAULT_EDITOR_SHORTCUTS);
    localStorage.setItem(EDITOR_SHORTCUTS_STORAGE_KEY, JSON.stringify({ bold: "Alt+7", italic: 3, link: null }));
    expect(getEditorShortcuts()).toEqual({ ...DEFAULT_EDITOR_SHORTCUTS, bold: "Alt+7", link: null });
    localStorage.setItem(EDITOR_SHORTCUTS_STORAGE_KEY, "not json");
    expect(getEditorShortcuts()).toEqual(DEFAULT_EDITOR_SHORTCUTS);
  });

  it("persists changes, clearing and restoring defaults", () => {
    setEditorShortcut("bold", "Alt+B");
    setEditorShortcut("link", null);
    expect(getEditorShortcuts()).toEqual({ ...DEFAULT_EDITOR_SHORTCUTS, bold: "Alt+B", link: null });
    expect(JSON.parse(localStorage.getItem(EDITOR_SHORTCUTS_STORAGE_KEY)!)).toEqual(getEditorShortcuts());
    resetEditorShortcuts();
    expect(localStorage.getItem(EDITOR_SHORTCUTS_STORAGE_KEY)).toBeNull();
    expect(getEditorShortcuts()).toEqual(DEFAULT_EDITOR_SHORTCUTS);
  });

  it.each(EDITOR_SHORTCUT_ACTIONS)("persists and clears the %s shortcut", (action) => {
    setEditorShortcut(action, "Alt+Q");
    expect(getEditorShortcuts()[action]).toBe("Alt+Q");
    expect(JSON.parse(localStorage.getItem(EDITOR_SHORTCUTS_STORAGE_KEY)!)[action]).toBe("Alt+Q");

    setEditorShortcut(action, null);
    expect(getEditorShortcuts()[action]).toBeNull();
  });

  it("captures and normalizes shortcuts for each platform", () => {
    expect(captureShortcut(keyEvent("b", { metaKey: true }), "mac")).toEqual({ type: "shortcut", shortcut: "Mod+B" });
    expect(captureShortcut(keyEvent("K", { ctrlKey: true, shiftKey: true }), "other")).toEqual({ type: "shortcut", shortcut: "Mod+Shift+K" });
    expect(captureShortcut(keyEvent("Shift", { shiftKey: true }), "other")).toEqual({ type: "pending" });
    expect(captureShortcut(keyEvent("b"), "other")).toEqual({ type: "invalid" });
    expect(captureShortcut(keyEvent("Escape"), "other")).toEqual({ type: "cancel" });
  });

  it("formats display, CodeMirror and aria values", () => {
    expect(formatShortcut("Mod+Shift+B", "mac")).toBe("⌘⇧B");
    expect(formatShortcut("Mod+Shift+B", "other")).toBe("Ctrl+Shift+B");
    expect(shortcutToCodeMirror("Mod+Shift+B")).toBe("Mod-Shift-b");
    expect(shortcutToAria("Mod+Shift+B", "mac")).toBe("Meta+Shift+B");
    expect(shortcutToAria("Mod+Shift+B", "other")).toBe("Control+Shift+B");
  });

  it("rejects invalid, duplicate and reserved shortcuts", () => {
    expect(validateShortcut("B", DEFAULT_EDITOR_SHORTCUTS, "bold")).toBe("invalid");
    expect(validateShortcut("Mod+I", DEFAULT_EDITOR_SHORTCUTS, "bold")).toBe("duplicate");
    expect(validateShortcut("Mod+Z", DEFAULT_EDITOR_SHORTCUTS, "bold", "other")).toBe("reserved");
    expect(validateShortcut("Alt+ArrowUp", DEFAULT_EDITOR_SHORTCUTS, "bold", "other")).toBe("reserved");
    expect(validateShortcut("Mod+I", { ...DEFAULT_EDITOR_SHORTCUTS, italic: null }, "bold", "other")).toBe("reserved");
    expect(validateShortcut("Ctrl+B", DEFAULT_EDITOR_SHORTCUTS, "bold", "mac")).toBe("reserved");
    expect(validateShortcut("Alt+B", DEFAULT_EDITOR_SHORTCUTS, "bold", "other")).toBeNull();
  });
});

function keyEvent(key: string, modifiers: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {}) {
  return { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers };
}
