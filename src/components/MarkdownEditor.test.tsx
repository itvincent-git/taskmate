import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEditorShortcut } from "../lib/editor-shortcuts";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
  beforeEach(() => localStorage.clear());

  it("uses a 14px document font size", () => {
    const { container } = render(<MarkdownEditor value="Document body" onChange={vi.fn()} />);

    expect(getComputedStyle(container.querySelector(".cm-editor")!)).toHaveProperty("fontSize", "14px");
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

    act(() => setEditorShortcut("bold", "Alt+B"));
    expect(screen.getByRole("button", { name: "Bold (Alt+B)" })).toHaveAttribute("aria-keyshortcuts", "Alt+B");

    act(() => setEditorShortcut("bold", null));
    expect(screen.getByRole("button", { name: "Bold" })).not.toHaveAttribute("aria-keyshortcuts");
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
