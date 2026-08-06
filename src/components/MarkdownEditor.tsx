import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Prec } from "@codemirror/state";
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
import { applyMarkdownAction, MARKDOWN_ACTIONS, type MarkdownAction } from "../editor/commands";
import { linkUrlAt, livePreview } from "../editor/livePreview";
import { api } from "../lib/api";
import {
  EDITOR_SHORTCUT_ACTIONS,
  captureShortcut,
  formatShortcut,
  getEditorShortcuts,
  getShortcutPlatform,
  shortcutToAria,
  shortcutToCodeMirror,
  subscribeEditorShortcuts,
  type EditorShortcuts,
} from "../lib/editor-shortcuts";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

interface Props {
  value: string;
  onChange(value: string): void;
}

const toolDetails: Record<MarkdownAction, [string, typeof Bold]> = {
  h1: ["Heading 1", Heading1],
  h2: ["Heading 2", Heading2],
  bold: ["Bold", Bold],
  italic: ["Italic", Italic],
  strike: ["Strikethrough", Strikethrough],
  inlineCode: ["Inline code", Code],
  codeBlock: ["Code block", Braces],
  quote: ["Quote", Quote],
  bullet: ["Bullet list", List],
  ordered: ["Ordered list", ListOrdered],
  task: ["Task list", CheckSquare],
  link: ["Link", Link],
  image: ["Image", Image],
  rule: ["Horizontal rule", Minus],
};

const syncValue = Annotation.define<boolean>();

export const MarkdownEditor = memo(function MarkdownEditor({ value, onChange }: Props) {
  const { locale, t } = useTaskmateI18n();
  const shortcuts = useSyncExternalStore(subscribeEditorShortcuts, getEditorShortcuts, getEditorShortcuts);
  const platform = getShortcutPlatform();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const shortcutCompartment = useRef(new Compartment());
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
          EditorView.domEventHandlers({
            mousedown(event, editorView) {
              const modifierPressed = platform === "mac" ? event.metaKey : event.ctrlKey;
              if (event.button !== 0 || !modifierPressed) return false;
              const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
              const url = position === null ? null : linkUrlAt(editorView.state, position);
              if (!url) return false;
              event.preventDefault();
              void api.openExternalUrl(url);
              return true;
            },
          }),
          placeholder(t("editor.placeholder")),
          shortcutCompartment.current.of(markdownShortcutExtensions(shortcuts, platform)),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(syncValue))) {
              changeHandler.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "14px" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-editor)" },
            ".cm-content": { minHeight: "300px", padding: "16px 20px 48px", caretColor: "var(--accent)" },
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
  }, [platform, t]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: shortcutCompartment.current.reconfigure(markdownShortcutExtensions(shortcuts, platform)),
    });
  }, [platform, shortcuts]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: syncValue.of(true),
    });
  }, [value]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border-b border-line">
      <div className="flex min-h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-3.5 py-1 [&_button]:size-7 [&_button]:min-h-0 [&_button]:p-0" role="toolbar" aria-label={t("editor.toolbar")}>
        {MARKDOWN_ACTIONS.map((action) => {
          const [label, Icon] = toolDetails[action];
          const actionLabel = locale === "zh-CN" ? toolbarLabel(action) : label;
          const shortcut = shortcuts[action];
          const accessibleLabel = shortcut ? `${actionLabel} (${formatShortcut(shortcut, platform)})` : actionLabel;
          return (
            <Tooltip label={accessibleLabel} key={action}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={accessibleLabel}
                aria-keyshortcuts={shortcut ? shortcutToAria(shortcut, platform) : undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (editor.current) applyMarkdownAction(editor.current, action);
                }}
              ><Icon size={16} /></Button>
            </Tooltip>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden [&_.cm-content]:min-h-full [&_.cm-editor]:h-full [&_.cm-editor]:min-h-0 [&_.cm-editor]:bg-surface [&_.cm-editor]:text-foreground [&_.cm-scroller]:h-full [&_.cm-scroller]:overscroll-contain [&_.cm-scroller]:overflow-y-auto!" ref={host} />
    </section>
  );
});

function markdownShortcutKeymap(shortcuts: EditorShortcuts) {
  return Prec.high(keymap.of(EDITOR_SHORTCUT_ACTIONS.flatMap((action) => {
    const shortcut = shortcuts[action];
    return shortcut ? [{
      key: shortcutToCodeMirror(shortcut),
      run(view: EditorView) {
        applyMarkdownAction(view, action);
        return true;
      },
    }] : [];
  })));
}

function markdownShortcutExtensions(shortcuts: EditorShortcuts, platform: ReturnType<typeof getShortcutPlatform>) {
  const extensions = [markdownShortcutKeymap(shortcuts)];
  if (platform !== "mac") return extensions;
  return [
    Prec.high(EditorView.domEventHandlers({
      keydown(event, view) {
        if (!event.altKey || event.ctrlKey || event.metaKey) return false;
        const captured = captureShortcut(event, platform);
        if (captured.type !== "shortcut") return false;
        const action = EDITOR_SHORTCUT_ACTIONS.find((candidate) => shortcuts[candidate] === captured.shortcut);
        if (!action) return false;
        applyMarkdownAction(view, action);
        return true;
      },
    })),
    ...extensions,
  ];
}

function toolbarLabel(action: MarkdownAction) {
  return {
    h1: "一级标题", h2: "二级标题", bold: "加粗", italic: "斜体", strike: "删除线",
    inlineCode: "行内代码", codeBlock: "代码块", quote: "引用", bullet: "无序列表",
    ordered: "有序列表", task: "任务列表", link: "链接", image: "图片", rule: "分割线",
  }[action];
}
