import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { applyMarkdownAction, type MarkdownAction } from "./commands";

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

  it("increments ordered list markers across a multiline selection", () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "one\ntwo\nthree", selection: { anchor: 0, head: 13 } }),
    });
    applyMarkdownAction(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. one\n2. two\n3. three");

    applyMarkdownAction(view, "ordered");
    expect(view.state.doc.toString()).toBe("one\ntwo\nthree");
  });

  it("preserves the caret within the text when removing a task marker", () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "- [ ] todo", selection: { anchor: 8 } }),
    });

    applyMarkdownAction(view, "task");

    expect(view.state.doc.toString()).toBe("todo");
    expect(view.state.selection.main.head).toBe(2);
  });

  const lists = [
    ["bullet", "- "],
    ["ordered", "1. "],
    ["task", "- [ ] "],
  ] as const;
  for (const [source, marker] of lists) {
    for (const [target, prefix] of lists) {
      if (source === target) continue;
      it(`converts ${source} to ${target} without stacking markers`, () => {
        view = new EditorView({
          parent: document.body,
          state: EditorState.create({ doc: `${marker}任务内容`, selection: { anchor: marker.length + 2 } }),
        });

        applyMarkdownAction(view, target);

        expect(view.state.doc.toString()).toBe(`${prefix}任务内容`);
        expect(view.state.selection.main.empty).toBe(true);
        expect(view.state.selection.main.head).toBe(prefix.length + (target === "task" ? 4 : 2));
      });
    }
  }

  it.each<[string, MarkdownAction, string]>([
    ["  * item", "ordered", "  1. item"],
    ["\t+ item", "task", "\t- [ ] item"],
    ["  42) item", "bullet", "  - item"],
    ["  + [x] item", "ordered", "  1. item"],
    ["7. [X] item", "bullet", "- item"],
    ["- [ ] ", "ordered", "1. "],
  ])("converts list marker variants and preserves indentation: %s", (doc, action, expected) => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, selection: { anchor: doc.length } }),
    });

    applyMarkdownAction(view, action);

    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(expected.length);
  });

  it("converts mixed selected lists and numbers each item once", () => {
    const doc = "- one\n+ [x] two\n  * three\nplain";
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, selection: { anchor: 0, head: doc.length } }),
    });

    applyMarkdownAction(view, "ordered");

    expect(view.state.doc.toString()).toBe("1. one\n2. two\n  3. three\n4. plain");
  });
});
