import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { getEditorShortcuts, type MarkdownShortcutAction } from "../lib/editor-shortcuts";
import { TaskmateI18nProvider } from "../lib/taskmate-i18n";
import { EditorShortcutSettings } from "./EditorShortcutSettings";

beforeEach(() => localStorage.clear());

describe("EditorShortcutSettings", () => {
  it.each<[MarkdownShortcutAction, string]>([
    ["h1", "Heading 1"],
    ["h2", "Heading 2"],
    ["bold", "Bold"],
    ["italic", "Italic"],
    ["strike", "Strikethrough"],
    ["inlineCode", "Inline code"],
    ["codeBlock", "Code block"],
    ["quote", "Quote"],
    ["bullet", "Bullet list"],
    ["ordered", "Ordered list"],
    ["task", "Task list"],
    ["link", "Link"],
    ["image", "Image"],
    ["rule", "Horizontal rule"],
  ])("records, persists, and clears the %s shortcut", async (action, label) => {
    const user = userEvent.setup();
    const first = renderSettings();
    const recorder = screen.getByRole("button", { name: `Change ${label} shortcut` });
    await user.click(recorder);
    fireEvent.keyDown(recorder, { key: "q", altKey: true });

    expect(getEditorShortcuts()[action]).toBe("Alt+Q");
    expect(recorder).toHaveTextContent("Alt+Q");
    first.unmount();
    renderSettings();
    const persisted = screen.getByRole("button", { name: `Change ${label} shortcut` });
    expect(persisted).toHaveTextContent("Alt+Q");

    await user.click(within(persisted.parentElement!).getByRole("button", { name: "Clear" }));
    expect(getEditorShortcuts()[action]).toBeNull();
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
    const recorder = screen.getByRole("button", { name: "Change Bold shortcut" });
    await user.click(within(recorder.parentElement!).getByRole("button", { name: "Clear" }));
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
    for (const label of [
      "一级标题", "二级标题", "加粗", "斜体", "删除线", "行内代码", "代码块",
      "引用", "无序列表", "有序列表", "任务列表", "链接", "图片", "分割线",
    ]) {
      expect(screen.getByRole("button", { name: `修改${label}快捷键` })).toBeInTheDocument();
    }
  });

  it("shows all Markdown toolbar actions", () => {
    renderSettings();
    for (const label of [
      "Heading 1", "Heading 2", "Bold", "Italic", "Strikethrough", "Inline code", "Code block",
      "Quote", "Bullet list", "Ordered list", "Task list", "Link", "Image", "Horizontal rule",
    ]) {
      expect(screen.getByRole("button", { name: `Change ${label} shortcut` })).toBeInTheDocument();
    }
  });
});

function renderSettings() {
  return render(<TaskmateI18nProvider><EditorShortcutSettings /></TaskmateI18nProvider>);
}
