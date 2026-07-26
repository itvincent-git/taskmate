import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { applyMarkdownAction } from "./commands";

let view: EditorView | null = null;
afterEach(() => view?.destroy());

describe("Markdown toolbar commands", () => {
  it("wraps the current selection and preserves a useful selection", () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "hello", selection: { anchor: 0, head: 5 } }),
    });
    applyMarkdownAction(view, "bold");
    expect(view.state.doc.toString()).toBe("**hello**");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("hello");
  });

  it("prefixes every line in a multiline selection", () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "one\ntwo", selection: { anchor: 0, head: 7 } }),
    });
    applyMarkdownAction(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] one\n- [ ] two");
  });
});
