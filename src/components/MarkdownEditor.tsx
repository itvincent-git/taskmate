import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView, placeholder } from "@codemirror/view";
import {
  Bold,
  Braces,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
} from "lucide-react";
import { applyMarkdownAction, type MarkdownAction } from "../editor/commands";
import { livePreview } from "../editor/livePreview";

interface Props {
  value: string;
  onChange(value: string): void;
}

const tools: Array<[MarkdownAction, string, typeof Bold]> = [
  ["h1", "Heading 1", Heading1],
  ["h2", "Heading 2", Heading2],
  ["bold", "Bold", Bold],
  ["italic", "Italic", Italic],
  ["strike", "Strikethrough", Strikethrough],
  ["inlineCode", "Inline code", Code],
  ["codeBlock", "Code block", Braces],
  ["quote", "Quote", Quote],
  ["bullet", "Bullet list", List],
  ["ordered", "Ordered list", ListOrdered],
  ["task", "Task list", CheckSquare],
  ["link", "Link", Link],
  ["image", "Image", Image],
  ["rule", "Horizontal rule", Minus],
];

export function MarkdownEditor({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const changeHandler = useRef(onChange);
  changeHandler.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown({ extensions: [GFM] }),
          syntaxHighlighting(defaultHighlightStyle),
          livePreview,
          placeholder("Write Markdown…"),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeHandler.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
            ".cm-content": { minHeight: "300px", padding: "22px 28px 80px", caretColor: "var(--accent)" },
            ".cm-line": { lineHeight: "1.72" },
            ".cm-gutters": { display: "none" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return (
    <section className="editor-section">
      <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
        {tools.map(([action, label, Icon]) => (
          <button key={action} type="button" title={label} aria-label={label} onMouseDown={(event) => {
            event.preventDefault();
            if (editor.current) applyMarkdownAction(editor.current, action);
          }}>
            <Icon size={16} />
          </button>
        ))}
      </div>
      <div className="editor-host" ref={host} />
    </section>
  );
}
