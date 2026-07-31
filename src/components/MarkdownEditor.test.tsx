import { render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
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
});
