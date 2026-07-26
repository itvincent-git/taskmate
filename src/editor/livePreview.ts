import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

const hiddenMarks = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "LinkMark",
  "URL",
]);

const styledNodes: Record<string, string> = {
  ATXHeading1: "cm-lp-h1",
  ATXHeading2: "cm-lp-h2",
  ATXHeading3: "cm-lp-h3",
  ATXHeading4: "cm-lp-h4",
  ATXHeading5: "cm-lp-h5",
  ATXHeading6: "cm-lp-h6",
  StrongEmphasis: "cm-lp-strong",
  Emphasis: "cm-lp-em",
  Strikethrough: "cm-lp-strike",
  InlineCode: "cm-lp-inline-code",
  FencedCode: "cm-lp-code-block",
  Blockquote: "cm-lp-quote",
  Link: "cm-lp-link",
  Image: "cm-lp-image",
};

export function rangeIsActive(
  from: number,
  to: number,
  ranges: readonly { from: number; to: number }[],
  composing = false,
) {
  if (composing) return true;
  return ranges.some((range) => range.from <= to && range.to >= from);
}

function nodeIsActive(state: EditorState, node: SyntaxNode, composing: boolean) {
  return rangeIsActive(node.from, node.to, state.selection.ranges, composing);
}

class MarkerWidget extends WidgetType {
  constructor(readonly kind: "bullet" | "ordered" | "task" | "quote" | "rule" | "image", readonly text = "") {
    super();
  }
  eq(other: MarkerWidget) {
    return this.kind === other.kind && this.text === other.text;
  }
  toDOM() {
    if (this.kind === "image") {
      const image = document.createElement("img");
      image.className = "cm-lp-image-widget";
      image.src = this.text;
      image.alt = "Markdown image";
      return image;
    }
    if (this.kind === "rule") {
      const rule = document.createElement("span");
      rule.className = "cm-lp-rule";
      return rule;
    }
    const marker = document.createElement("span");
    marker.className = `cm-lp-marker cm-lp-marker-${this.kind}`;
    marker.textContent = this.kind === "bullet" ? "•" : this.kind === "quote" ? "│" : this.kind === "task" ? "☐" : this.text.trim();
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  for (const viewport of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: viewport.from,
      to: viewport.to,
      enter(node) {
        const activeNode = node.node.parent ?? node.node;
        const active = nodeIsActive(view.state, activeNode, view.composing);
        if (!active && node.name === "Image") {
          const source = view.state.sliceDoc(node.from, node.to).match(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/)?.[1] || "";
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("image", source) }) });
          return false;
        }
        if (!active && node.name === "HorizontalRule") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("rule") }) });
          return false;
        }
        const style = styledNodes[node.name];
        if (style) {
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.mark({ class: style }),
          });
        }
        if (!active && node.name === "ListMark") {
          const marker = view.state.sliceDoc(node.from, node.to);
          const kind = /^\d/.test(marker) ? "ordered" : "bullet";
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget(kind, marker) }) });
        } else if (!active && node.name === "TaskMarker") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("task") }) });
        } else if (!active && node.name === "QuoteMark") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("quote") }) });
        } else if (!active && hiddenMarks.has(node.name) && node.to > node.from) {
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.replace({ inclusive: false }),
          });
        }
      },
    });
  }
  ranges
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .forEach(({ from, to, decoration }) => builder.add(from, to, decoration));
  return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some((transaction) => transaction.reconfigured)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
