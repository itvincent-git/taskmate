import type { EditorView } from "@codemirror/view";

export const MARKDOWN_ACTIONS = [
  "h1", "h2", "bold", "italic", "strike", "inlineCode", "codeBlock",
  "quote", "bullet", "ordered", "task", "link", "image", "rule",
] as const;

export type MarkdownAction = (typeof MARKDOWN_ACTIONS)[number];

const wraps: Partial<Record<MarkdownAction, [string, string, string]>> = {
  bold: ["**", "**", "bold text"],
  italic: ["*", "*", "italic text"],
  strike: ["~~", "~~", "strikethrough"],
  inlineCode: ["`", "`", "code"],
  codeBlock: ["```\n", "\n```", "code"],
  link: ["[", "](https://)", "link text"],
  image: ["![", "](attachments/image.png)", "alt text"],
};

export function applyMarkdownAction(view: EditorView, action: MarkdownAction) {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const wrap = wraps[action];
  if (wrap) {
    const [before, after, placeholder] = wrap;
    const content = selected || placeholder;
    const existing =
      selection.from >= before.length &&
      view.state.sliceDoc(selection.from - before.length, selection.from) === before &&
      view.state.sliceDoc(selection.to, selection.to + after.length) === after;
    if (existing) {
      view.dispatch({
        changes: [
          { from: selection.from - before.length, to: selection.from, insert: "" },
          { from: selection.to, to: selection.to + after.length, insert: "" },
        ],
        selection: { anchor: selection.from - before.length, head: selection.to - before.length },
        userEvent: "input",
      });
    } else {
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: before + content + after },
        selection: {
          anchor: selection.from + before.length,
          head: selection.from + before.length + content.length,
        },
        userEvent: "input",
      });
    }
    view.focus();
    return;
  }

  if (action === "rule") {
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `${selected ? `${selected}\n` : ""}---\n` },
      selection: { anchor: selection.from + (selected ? selected.length + 5 : 4) },
      userEvent: "input",
    });
    view.focus();
    return;
  }

  const prefixes: Partial<Record<MarkdownAction, string>> = {
    h1: "# ",
    h2: "## ",
    quote: "> ",
    bullet: "- ",
    ordered: "1. ",
    task: "- [ ] ",
  };
  const prefix = prefixes[action];
  if (!prefix) return;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const changes = [];
  for (let number = startLine.number; number <= endLine.number; number += 1) {
    const line = view.state.doc.line(number);
    const linePrefix = action === "ordered" ? `${number - startLine.number + 1}. ` : prefix;
    const existingPrefix = view.state.sliceDoc(line.from, Math.min(line.to, line.from + linePrefix.length));
    changes.push(existingPrefix === linePrefix
      ? { from: line.from, to: line.from + linePrefix.length, insert: "" }
      : { from: line.from, insert: linePrefix });
  }
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
}
