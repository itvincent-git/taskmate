import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { api } from "../lib/api";

let taskCheckIcon: SVGSVGElement | null = null;

function cloneTaskCheckIcon() {
  if (taskCheckIcon) return taskCheckIcon.cloneNode(true);
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "lucide lucide-check");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "3");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const check = document.createElementNS("http://www.w3.org/2000/svg", "path");
  check.setAttribute("d", "M20 6 9 17l-5-5");
  icon.append(check);
  taskCheckIcon = icon;
  return taskCheckIcon.cloneNode(true);
}

const hiddenMarks = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "CodeInfo",
  "QuoteMark",
  "LinkMark",
]);

const styledNodes: Record<string, string> = {
  ATXHeading1: "text-[1.85em] font-[760] leading-[1.45] no-underline",
  ATXHeading2: "text-[1.52em] font-[730] leading-[1.5] no-underline",
  ATXHeading3: "text-[1.3em] font-bold no-underline",
  ATXHeading4: "font-bold no-underline",
  ATXHeading5: "font-bold no-underline",
  ATXHeading6: "font-bold no-underline",
  StrongEmphasis: "font-[750]",
  Emphasis: "italic",
  Strikethrough: "text-muted line-through",
  InlineCode: "rounded border border-line bg-surface-soft px-1 py-px font-mono text-[.9em]",
  FencedCode: "bg-surface-soft font-mono",
  Blockquote: "text-muted",
  Link: "text-accent underline underline-offset-2",
  URL: "text-accent underline underline-offset-2",
  Image: "",
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

type TableAlignment = "left" | "center" | "right" | undefined;

class MarkerWidget extends WidgetType {
  constructor(
    readonly kind: "bullet" | "ordered" | "task" | "quote" | "rule" | "image",
    readonly text = "",
    readonly from = 0,
  ) {
    super();
  }
  eq(other: MarkerWidget) {
    return this.kind === other.kind && this.text === other.text && this.from === other.from;
  }
  toDOM(view: EditorView) {
    if (this.kind === "image") {
      const image = document.createElement("img");
      image.className = "my-2 block max-h-[360px] max-w-[min(100%,560px)] rounded-lg border border-line object-contain";
      image.dataset.previewKind = "image";
      image.alt = this.text || "Markdown image";
      void api.resolveAttachment(this.text).then((source) => { image.src = source; }).catch(() => {
        image.className = "my-2 block min-h-[72px] max-h-[360px] min-w-[180px] max-w-[min(100%,560px)] rounded-lg border border-line bg-surface-soft p-3 object-contain text-muted";
        image.title = `Unable to load attachment: ${this.text}`;
      });
      return image;
    }
    if (this.kind === "rule") {
      const rule = document.createElement("span");
      rule.className = "my-[.85em] block h-px bg-line";
      rule.dataset.previewKind = "rule";
      return rule;
    }
    if (this.kind === "task") {
      const checked = /^\[[xX]\]$/.test(this.text.trim());
      const checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.className = "mr-[7px] inline-grid size-[18px] cursor-pointer place-items-center rounded-[5px] border-2 border-neutral bg-transparent p-0 align-[-3px] text-white transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] data-[checked=true]:border-accent data-[checked=true]:bg-accent";
      checkbox.dataset.markerKind = "task";
      checkbox.dataset.checked = String(checked);
      checkbox.setAttribute("role", "checkbox");
      checkbox.setAttribute("aria-checked", String(checked));
      checkbox.setAttribute("aria-label", checked ? "Mark task incomplete" : "Mark task complete");
      if (checked) checkbox.append(cloneTaskCheckIcon());
      checkbox.addEventListener("mousedown", (event) => event.preventDefault());
      checkbox.addEventListener("click", () => {
        view.dispatch({
          changes: { from: this.from, to: this.from + this.text.length, insert: checked ? "[ ]" : "[x]" },
        });
      });
      return checkbox;
    }
    const marker = document.createElement("span");
    marker.className = this.kind === "quote"
      ? "mr-2.5 inline-block min-w-3 text-center font-bold text-[color-mix(in_srgb,var(--accent)_65%,transparent)]"
      : "mr-[7px] inline-block min-w-3 text-center font-bold text-accent";
    marker.dataset.markerKind = this.kind;
    marker.textContent = this.kind === "bullet"
      ? "•"
      : this.kind === "quote"
        ? "│"
        : this.text.trim();
    return marker;
  }
  ignoreEvent() {
    return this.kind === "task";
  }
}

class TableRowWidget extends WidgetType {
  constructor(
    readonly values: string[],
    readonly alignments: TableAlignment[],
    readonly header: boolean,
  ) {
    super();
  }
  eq(other: TableRowWidget) {
    return this.header === other.header
      && JSON.stringify(this.values) === JSON.stringify(other.values)
      && JSON.stringify(this.alignments) === JSON.stringify(other.alignments);
  }
  toDOM() {
    const row = document.createElement("span");
    row.className = this.header
      ? "inline-grid w-full border-t border-l border-line bg-surface-soft align-top text-[.92em] font-bold [&>span]:min-w-0 [&>span]:border-r [&>span]:border-b [&>span]:border-line [&>span]:px-2.5 [&>span]:py-[7px]"
      : "inline-grid w-full border-l border-line align-top text-[.92em] [&>span]:min-w-0 [&>span]:border-r [&>span]:border-b [&>span]:border-line [&>span]:px-2.5 [&>span]:py-[7px]";
    row.dataset.previewKind = "table-row";
    row.setAttribute("role", "row");
    row.style.gridTemplateColumns = `repeat(${this.values.length}, minmax(0, 1fr))`;
    this.values.forEach((value, index) => {
      const cell = document.createElement("span");
      cell.setAttribute("role", this.header ? "columnheader" : "cell");
      cell.textContent = value;
      cell.style.textAlign = this.alignments[index] ?? "left";
      row.append(cell);
    });
    return row;
  }
  ignoreEvent() {
    return false;
  }
}

function tableDecorations(state: EditorState, node: SyntaxNode) {
  const header = node.getChild("TableHeader");
  const rows = node.getChildren("TableRow");
  const separator = node.getChildren("TableDelimiter")[0];
  const cells = (row: SyntaxNode | null) =>
    row?.getChildren("TableCell").map((cell) => state.sliceDoc(cell.from, cell.to).trim()) ?? [];
  const alignments = separator
    ? state.sliceDoc(separator.from, separator.to).split("|").filter((part) => part.trim()).map((part): TableAlignment => {
      const value = part.trim();
      if (value.startsWith(":") && value.endsWith(":")) return "center";
      if (value.endsWith(":")) return "right";
      return "left";
    })
    : [];
  const tableRows = [
    ...(header ? [{ node: header, values: cells(header), header: true }] : []),
    ...rows.map((row) => ({ node: row, values: cells(row), header: false })),
  ];
  return {
    separator,
    rows: tableRows.map((row) => ({
      from: row.node.from,
      to: row.node.to,
      decoration: Decoration.replace({
        widget: new TableRowWidget(row.values, alignments, row.header),
      }),
    })),
  };
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  for (const viewport of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: viewport.from,
      to: viewport.to,
      enter(node) {
        const activeNode = node.node.parent?.name === "Document"
          ? node.node
          : node.node.parent ?? node.node;
        const active = nodeIsActive(view.state, activeNode, view.composing);
        if (!active && node.name === "Table") {
          const table = tableDecorations(view.state, node.node);
          ranges.push(...table.rows);
          if (table.separator) {
            ranges.push({
              from: table.separator.from,
              to: table.separator.from,
              decoration: Decoration.line({ class: "hidden" }),
            });
            ranges.push({
              from: table.separator.from,
              to: table.separator.to,
              decoration: Decoration.replace({}),
            });
          }
          return false;
        }
        if (!active && node.name === "Image") {
          const source = view.state.sliceDoc(node.from, node.to).match(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/)?.[1] || "";
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("image", source) }) });
          return false;
        }
        if (!active && node.name === "HorizontalRule") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("rule") }) });
          return false;
        }
        const isLinkTarget = node.name === "URL" && node.node.parent?.name === "Link";
        const style = isLinkTarget ? undefined : styledNodes[node.name];
        if (style) {
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.mark({ class: style }),
          });
        }
        if (!active && node.name === "ListMark") {
          const taskMarker = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
          if (taskMarker) {
            ranges.push({ from: node.from, to: taskMarker.from, decoration: Decoration.replace({}) });
            return;
          }
          const marker = view.state.sliceDoc(node.from, node.to);
          const kind = /^\d/.test(marker) ? "ordered" : "bullet";
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget(kind, marker) }) });
        } else if (!active && node.name === "TaskMarker") {
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.replace({
              widget: new MarkerWidget("task", view.state.sliceDoc(node.from, node.to), node.from),
            }),
          });
        } else if (!active && node.name === "QuoteMark") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("quote") }) });
        } else if (
          !active &&
          (hiddenMarks.has(node.name) || isLinkTarget) &&
          node.to > node.from
        ) {
          let to = node.to;
          if (
            node.name === "HeaderMark" &&
            node.node.parent &&
            /^[ \t]*$/.test(view.state.sliceDoc(node.node.parent.from, node.from))
          ) {
            while (/[ \t]/.test(view.state.sliceDoc(to, to + 1))) to += 1;
          }
          ranges.push({
            from: node.from,
            to,
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
