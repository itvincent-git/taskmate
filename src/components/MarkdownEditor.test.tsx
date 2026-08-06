import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEditorShortcut, type MarkdownShortcutAction } from "../lib/editor-shortcuts";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
  beforeEach(() => localStorage.clear());

  it("uses a 14px document font size", () => {
    const { container } = render(<MarkdownEditor value="Document body" onChange={vi.fn()} />);

    expect(getComputedStyle(container.querySelector(".cm-editor")!)).toHaveProperty("fontSize", "14px");
    expect(getComputedStyle(container.querySelector(".cm-scroller")!)).toHaveProperty("fontFamily", "var(--font-editor)");
  });

  it("syncs a changed value without reporting a user edit", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<MarkdownEditor value="First body" onChange={onChange} />);

    rerender(<MarkdownEditor value="Second body" onChange={onChange} />);

    expect(container.querySelector(".cm-content")).toHaveTextContent("Second body");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports ordinary editor transactions", () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor value="First body" onChange={onChange} />);
    const editor = container.querySelector<HTMLElement>(".cm-editor");
    const view = editor ? EditorView.findFromDOM(editor) : null;

    view?.dispatch({ changes: { from: view.state.doc.length, insert: " changed" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("First body changed");
  });

  it("reports task checkbox clicks as document changes", () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor value={"plain\n- [ ] todo"} onChange={onChange} />);

    container.querySelector<HTMLButtonElement>('[data-marker-kind="task"]')?.click();

    expect(onChange).toHaveBeenCalledWith("plain\n- [x] todo");
  });

  it("renders checked task items without crashing", () => {
    const { container } = render(<StrictMode><MarkdownEditor value={"plain\n- [x] done"} onChange={vi.fn()} /></StrictMode>);

    expect(container.querySelector('[data-marker-kind="task"] svg')).toHaveClass("lucide", "lucide-check");
  });

  it.each([
    ["b", "**text**"],
    ["i", "*text*"],
    ["k", "[text](https://)"],
    ["l", "- [ ] text"],
  ])("applies the default Mod+%s shortcut", (key, expected) => {
    const { container } = render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    const view = editorView(container);
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.keyDown(container.querySelector(".cm-content")!, { key, ctrlKey: true });

    expect(view.state.doc.toString()).toBe(expected);
  });

  it.each<[MarkdownShortcutAction, string]>([
    ["h1", "# text"],
    ["h2", "## text"],
    ["bold", "**text**"],
    ["italic", "*text*"],
    ["strike", "~~text~~"],
    ["inlineCode", "`text`"],
    ["codeBlock", "```\ntext\n```"],
    ["quote", "> text"],
    ["bullet", "- text"],
    ["ordered", "1. text"],
    ["task", "- [ ] text"],
    ["link", "[text](https://)"],
    ["image", "![text](attachments/image.png)"],
    ["rule", "text\n---\n"],
  ])("applies a custom shortcut for %s", (action, expected) => {
    act(() => setEditorShortcut(action, "Alt+Q"));
    const { container } = render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    const view = editorView(container);
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "q", altKey: true });

    expect(view.state.doc.toString()).toBe(expected);
  });

  it("applies macOS Option shortcuts using the physical key code", () => {
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    act(() => setEditorShortcut("h1", "Alt+Q"));
    const { container } = render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    const view = editorView(container);
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "œ", code: "KeyQ", altKey: true });

    expect(view.state.doc.toString()).toBe("# text");
    platform.mockRestore();
  });

  it("replaces the old shortcut and removes a cleared shortcut", () => {
    act(() => setEditorShortcut("bold", "Alt+B"));
    const { container, unmount } = render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    const view = editorView(container);
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "b", ctrlKey: true });
    expect(view.state.doc.toString()).toBe("text");
    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "b", altKey: true });
    expect(view.state.doc.toString()).toBe("**text**");

    unmount();
    act(() => setEditorShortcut("bold", null));
    const cleared = render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    const clearedView = editorView(cleared.container);
    clearedView.dispatch({ selection: { anchor: 0, head: 4 } });
    fireEvent.keyDown(cleared.container.querySelector(".cm-content")!, { key: "b", ctrlKey: true });
    expect(clearedView.state.doc.toString()).toBe("text");
  });

  it("keeps toolbar labels and aria shortcuts in sync", () => {
    render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bold (Ctrl+B)" })).toHaveAttribute("aria-keyshortcuts", "Control+B");
    expect(screen.getByRole("button", { name: "Heading 1" })).not.toHaveAttribute("aria-keyshortcuts");

    act(() => setEditorShortcut("bold", "Alt+B"));
    expect(screen.getByRole("button", { name: "Bold (Alt+B)" })).toHaveAttribute("aria-keyshortcuts", "Alt+B");

    act(() => setEditorShortcut("h1", "Alt+1"));
    expect(screen.getByRole("button", { name: "Heading 1 (Alt+1)" })).toHaveAttribute("aria-keyshortcuts", "Alt+1");

    act(() => setEditorShortcut("bold", null));
    expect(screen.getByRole("button", { name: "Bold" })).not.toHaveAttribute("aria-keyshortcuts");

    act(() => setEditorShortcut("h1", null));
    expect(screen.getByRole("button", { name: "Heading 1" })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("preserves Tab indentation and undo", () => {
    const { container } = render(<MarkdownEditor value="text" onChange={vi.fn()} />);
    const view = editorView(container);
    view.dispatch({ selection: { anchor: 0 } });
    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "Tab" });
    expect(view.state.doc.toString()).not.toBe("text");

    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "z", ctrlKey: true });
    expect(view.state.doc.toString()).toBe("text");
  });
});

function editorView(container: HTMLElement) {
  return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
}
