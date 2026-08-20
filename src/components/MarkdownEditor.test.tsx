import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEditorShortcut, type MarkdownShortcutAction } from "../lib/editor-shortcuts";
import { api } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses a 14px document font size", () => {
    const { container } = render(<MarkdownEditor value="Document body" onChange={vi.fn()} />);

    expect(getComputedStyle(container.querySelector(".cm-editor")!)).toHaveProperty("fontSize", "14px");
    expect(getComputedStyle(container.querySelector(".cm-scroller")!)).toHaveProperty("fontFamily", "var(--font-editor)");
  });

  it("styles fenced code as a GitHub-like code block", () => {
    const { container } = render(
      <MarkdownEditor value={"```js\nconst answer = 42;\n```"} onChange={vi.fn()} />,
    );

    const lines = container.querySelectorAll("[data-code-block-line]");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveClass("cm-codeblock-first");
    expect(lines[1]).toHaveClass("cm-codeblock-line");
    expect(lines[2]).toHaveClass("cm-codeblock-last");
    expect(getComputedStyle(lines[1]!)).toHaveProperty("backgroundColor", "var(--code-bg)");
  });

  it("loads syntax highlighting inside fenced code", async () => {
    const { container } = render(
      <MarkdownEditor value={"```js\nconst value = 1;\n```"} onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-code-block-line] span[class]")).not.toBeNull();
    });
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

  it("shows raw Markdown when source mode is enabled", () => {
    const { container, rerender } = render(
      <MarkdownEditor value={"plain\n- [ ] todo"} onChange={vi.fn()} />,
    );

    expect(container.querySelector('[data-marker-kind="task"]')).not.toBeNull();

    rerender(<MarkdownEditor value={"plain\n- [ ] todo"} onChange={vi.fn()} sourceMode />);

    expect(container.querySelector('[data-marker-kind="task"]')).toBeNull();
    expect(container.querySelector(".cm-content")).toHaveTextContent("- [ ] todo");
  });

  it.each([
    ["MacIntel", { metaKey: true }],
    ["Win32", { ctrlKey: true }],
  ])("opens links without entering edit mode using the platform modifier on %s", (platform, modifier) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords");
    const openExternalUrl = vi.spyOn(api, "openExternalUrl").mockResolvedValue();
    const { container } = render(<MarkdownEditor value={"plain\n[OpenAI](https://openai.com)"} onChange={vi.fn()} />);
    const view = editorView(container);

    fireEvent.mouseDown(container.querySelector('[data-link-url="https://openai.com"]')!, modifier);

    expect(openExternalUrl).toHaveBeenCalledWith("https://openai.com");
    expect(posAtCoords).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(0);
  });

  it("keeps ordinary link clicks in the editor", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const openExternalUrl = vi.spyOn(api, "openExternalUrl").mockResolvedValue();
    const { container } = render(<MarkdownEditor value={"plain\n[OpenAI](https://openai.com)"} onChange={vi.fn()} />);

    fireEvent.mouseDown(container.querySelector('[data-link-url="https://openai.com"]')!);

    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("shows a link cursor only while the platform modifier is pressed", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { container } = render(
      <MarkdownEditor value="[OpenAI](https://openai.com) plain" onChange={vi.fn()} />,
    );
    const editor = container.querySelector<HTMLElement>(".cm-editor")!;
    const link = container.querySelector<HTMLElement>('[data-link-url="https://openai.com"]')!;

    expect(getComputedStyle(link)).not.toHaveProperty("cursor", "pointer");

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    expect(editor).toHaveClass("cm-modifier-links");
    expect(getComputedStyle(link)).toHaveProperty("cursor", "pointer");

    fireEvent.keyUp(window, { key: "Meta" });
    expect(editor).not.toHaveClass("cm-modifier-links");
    expect(getComputedStyle(link)).not.toHaveProperty("cursor", "pointer");
  });

  it("reports failures to open external links", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const failure = new Error("Unable to open link");
    const onError = vi.fn();
    vi.spyOn(api, "openExternalUrl").mockRejectedValue(failure);
    const { container } = render(
      <MarkdownEditor value="[OpenAI](https://openai.com)" onChange={vi.fn()} onError={onError} />,
    );

    fireEvent.mouseDown(container.querySelector('[data-link-url="https://openai.com"]')!, { metaKey: true });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
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
