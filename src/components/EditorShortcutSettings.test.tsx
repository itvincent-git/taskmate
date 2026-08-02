import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { getEditorShortcuts } from "../lib/editor-shortcuts";
import { TaskmateI18nProvider } from "../lib/taskmate-i18n";
import { EditorShortcutSettings } from "./EditorShortcutSettings";

beforeEach(() => localStorage.clear());

describe("EditorShortcutSettings", () => {
  it("records immediately and keeps the preference after remounting", async () => {
    const user = userEvent.setup();
    const first = renderSettings();
    const recorder = screen.getByRole("button", { name: "Change Bold shortcut" });
    await user.click(recorder);
    fireEvent.keyDown(recorder, { key: "b", altKey: true });

    expect(getEditorShortcuts().bold).toBe("Alt+B");
    expect(recorder).toHaveTextContent("Alt+B");
    first.unmount();
    renderSettings();
    expect(screen.getByRole("button", { name: "Change Bold shortcut" })).toHaveTextContent("Alt+B");
  });

  it("does not replace the old value when a shortcut conflicts", async () => {
    const user = userEvent.setup();
    renderSettings();
    const recorder = screen.getByRole("button", { name: "Change Bold shortcut" });
    await user.click(recorder);
    fireEvent.keyDown(recorder, { key: "i", ctrlKey: true });

    expect(screen.getByRole("alert")).toHaveTextContent("already assigned");
    expect(getEditorShortcuts().bold).toBe("Mod+B");
    fireEvent.keyDown(recorder, { key: "Escape" });
    expect(recorder).toHaveTextContent("Ctrl+B");
  });

  it("clears an action and restores all defaults", async () => {
    const user = userEvent.setup();
    renderSettings();
    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    await user.click(clearButtons[0]);
    expect(getEditorShortcuts().bold).toBeNull();
    expect(screen.getByRole("button", { name: "Change Bold shortcut" })).toHaveTextContent("Not assigned");

    await user.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(getEditorShortcuts().bold).toBe("Mod+B");
  });

  it("shows localized labels", () => {
    localStorage.setItem("taskmate.locale.v1", "zh-CN");
    renderSettings();
    expect(screen.getByRole("heading", { name: "键盘快捷键" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改加粗快捷键" })).toHaveTextContent("Ctrl+B");
  });
});

function renderSettings() {
  return render(<TaskmateI18nProvider><EditorShortcutSettings /></TaskmateI18nProvider>);
}
