import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
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
  Blockquote: "text-muted",
  Link: "text-accent underline underline-offset-2",
  URL: "text-accent underline underline-offset-2",
  Image: "",
};

const allowedHtmlTags = new Set([
  "a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "kbd", "li", "mark", "ol",
  "p", "pre", "q", "s", "small", "span", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul",
]);

const voidHtmlTags = new Set(["br", "hr"]);

const htmlTagClasses: Partial<Record<string, string>> = {
  a: "text-accent underline underline-offset-2",
  blockquote: "my-2 border-l-3 border-line pl-3 text-muted",
  code: "rounded border border-line bg-surface-soft px-1 py-px font-mono text-[.9em]",
  details: "my-2 rounded-md border border-line px-3 py-2",
  h1: "my-2 text-[1.85em] font-[760] leading-[1.45]",
  h2: "my-2 text-[1.52em] font-[730] leading-[1.5]",
  h3: "my-2 text-[1.3em] font-bold",
  h4: "my-2 font-bold",
  h5: "my-2 font-bold",
  h6: "my-2 font-bold",
  hr: "my-3 border-0 border-t border-line",
  kbd: "rounded border border-line bg-surface-soft px-1.5 py-0.5 font-mono text-[.85em] shadow-sm",
  mark: "rounded bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] px-0.5 text-inherit",
  ol: "my-2 list-decimal pl-6",
  pre: "my-2 overflow-x-auto rounded-md bg-surface-soft p-3 font-mono text-[.9em]",
  summary: "cursor-pointer font-semibold",
  table: "my-2 border-collapse",
  td: "border border-line px-2.5 py-1.5",
  th: "border border-line bg-surface-soft px-2.5 py-1.5 font-bold",
  ul: "my-2 list-disc pl-6",
};

function htmlTag(source: string) {
  const match = source.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)\b[^>]*?(\/?)>$/s);
  if (!match) return null;
  return {
    closing: Boolean(match[1]),
    name: match[2].toLowerCase(),
    selfClosing: Boolean(match[3]),
  };
}

function safeLinkUrl(value: string) {
  return /^(?:https?:|mailto:)/i.test(value) ? value : null;
}

function sanitizedHtmlNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? "");
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style") return null;

  const children = document.createDocumentFragment();
  node.childNodes.forEach((child) => {
    const sanitized = sanitizedHtmlNode(child);
    if (sanitized) children.append(sanitized);
  });
  if (!allowedHtmlTags.has(tag)) return children;

  const element = document.createElement(tag);
  const className = htmlTagClasses[tag];
  if (className) element.className = className;
  element.append(children);
  if (tag === "details" && node.hasAttribute("open")) element.setAttribute("open", "");
  if (tag === "abbr" || tag === "q") {
    const title = node.getAttribute("title");
    if (title) element.setAttribute("title", title);
  }
  if (tag === "time") {
    const dateTime = node.getAttribute("datetime");
    if (dateTime) element.setAttribute("datetime", dateTime);
  }
  if (tag === "ol") {
    const start = node.getAttribute("start");
    if (start && /^-?\d+$/.test(start)) element.setAttribute("start", start);
  }
  if (tag === "td" || tag === "th") {
    for (const attribute of ["colspan", "rowspan"] as const) {
      const value = node.getAttribute(attribute);
      if (value && /^\d+$/.test(value)) element.setAttribute(attribute, value);
    }
  }
  if (tag === "a") {
    const href = safeLinkUrl(node.getAttribute("href") ?? "");
    if (href) {
      element.setAttribute("data-link-url", href);
    }
  }
  return element;
}

class HtmlWidget extends WidgetType {
  constructor(readonly source: string, readonly block: boolean) {
    super();
  }
  eq(other: HtmlWidget) {
    return this.source === other.source && this.block === other.block;
  }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = this.block ? "cm-html-preview cm-html-preview-block" : "cm-html-preview";
    wrapper.dataset.previewKind = "html";
    const parsed = new DOMParser().parseFromString(this.source, "text/html");
    parsed.body.childNodes.forEach((child) => {
      const sanitized = sanitizedHtmlNode(child);
      if (sanitized) wrapper.append(sanitized);
    });
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly source: string, readonly block: boolean) {
    super();
  }
  eq(other: MathWidget) {
    return this.source === other.source && this.block === other.block;
  }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = this.block
      ? "cm-math-preview cm-math-preview-block my-2 block overflow-x-auto py-1 text-center"
      : "cm-math-preview inline-block align-middle";
    wrapper.dataset.previewKind = "math";
    katex.render(this.source, wrapper, {
      displayMode: this.block,
      throwOnError: false,
      trust: false,
    });
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

let mermaidId = 0;

class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return this.source === other.source;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-mermaid-preview my-3 block overflow-x-auto rounded-lg border border-line bg-surface-soft p-4 text-center";
    wrapper.dataset.previewKind = "mermaid";
    wrapper.setAttribute("aria-label", "Mermaid diagram");
    wrapper.textContent = "Rendering diagram…";
    void renderMermaid(wrapper, this.source, view);
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

async function renderMermaid(wrapper: HTMLElement, source: string, view: EditorView) {
  try {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
    });
    const { svg, bindFunctions } = await mermaid.render(`taskmate-mermaid-${mermaidId += 1}`, source);
    if (!wrapper.isConnected) return;
    wrapper.innerHTML = svg;
    bindFunctions?.(wrapper);
    view.requestMeasure();
  } catch (cause) {
    if (!wrapper.isConnected) return;
    wrapper.classList.add("text-danger");
    wrapper.textContent = cause instanceof Error ? `Mermaid: ${cause.message}` : "Unable to render Mermaid diagram";
    view.requestMeasure();
  }
}

export function rangeIsActive(
  from: number,
  to: number,
  ranges: readonly { from: number; to: number }[],
  _composing = false,
) {
  return ranges.some((range) => range.from <= to && range.to >= from);
}

export function linkUrlAt(state: EditorState, position: number): string | null {
  for (const bias of [1, -1] as const) {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, bias);
    while (node && node.name !== "Link" && node.name !== "Autolink" && node.name !== "URL") {
      node = node.parent;
    }
    if (!node) continue;
    const url = node.name === "URL" ? node : node.getChild("URL");
    if (url) return state.sliceDoc(url.from, url.to);
  }
  return null;
}

function nodeIsActive(state: EditorState, node: SyntaxNode, composing: boolean) {
  return rangeIsActive(node.from, node.to, state.selection.ranges, composing);
}

type TableAlignment = "left" | "center" | "right" | undefined;

type TableCellContent = {
  text?: string;
  className?: string;
  linkUrl?: string;
  children?: TableCellContent[];
};

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
    readonly values: TableCellContent[][],
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
      appendTableCellContent(cell, value);
      cell.style.textAlign = this.alignments[index] ?? "left";
      row.append(cell);
    });
    return row;
  }
  ignoreEvent() {
    return false;
  }
}

function appendTableCellContent(parent: HTMLElement, parts: TableCellContent[]) {
  parts.forEach((part) => {
    if (part.text !== undefined) {
      parent.append(document.createTextNode(part.text));
      return;
    }
    const element = document.createElement("span");
    if (part.className) element.className = part.className;
    if (part.linkUrl) element.dataset.linkUrl = part.linkUrl;
    appendTableCellContent(element, part.children ?? []);
    parent.append(element);
  });
}

function tableCellContent(state: EditorState, cell: SyntaxNode): TableCellContent[] {
  const parts: TableCellContent[] = [];
  let position = cell.from;
  for (let child = cell.firstChild; child; child = child.nextSibling) {
    if (child.from > position) parts.push({ text: state.sliceDoc(position, child.from) });
    if (child.name === "Escape") {
      parts.push({ text: state.sliceDoc(child.from + 1, child.to) });
    } else if (!hiddenMarks.has(child.name) && !(child.name === "URL" && cell.name === "Link")) {
      const className = styledNodes[child.name];
      const url = child.name === "Link"
        ? child.getChild("URL")
        : child.name === "URL"
          ? child
          : null;
      if (className || child.firstChild) {
        parts.push({
          className,
          linkUrl: url ? state.sliceDoc(url.from, url.to) : undefined,
          children: tableCellContent(state, child),
        });
      } else {
        parts.push({ text: state.sliceDoc(child.from, child.to) });
      }
    }
    position = child.to;
  }
  if (position < cell.to) parts.push({ text: state.sliceDoc(position, cell.to) });
  return parts;
}

function tableCells(state: EditorState, row: SyntaxNode) {
  const delimiters = row.getChildren("TableDelimiter");
  const cells = row.getChildren("TableCell");
  const regions: Array<{ from: number; to: number }> = [];
  let from = row.from;
  delimiters.forEach((delimiter) => {
    regions.push({ from, to: delimiter.from });
    from = delimiter.to;
  });
  regions.push({ from, to: row.to });
  if (delimiters[0]?.from === row.from) regions.shift();
  if (delimiters.at(-1)?.to === row.to) regions.pop();
  return regions.map((region) => {
    const cell = cells.find((candidate) => candidate.from >= region.from && candidate.to <= region.to);
    return cell ? tableCellContent(state, cell) : [];
  });
}

function tableDecorations(state: EditorState, node: SyntaxNode) {
  const header = node.getChild("TableHeader");
  const rows = node.getChildren("TableRow");
  const separator = node.getChildren("TableDelimiter")[0];
  const alignments = separator
    ? state.sliceDoc(separator.from, separator.to).split("|").filter((part) => part.trim()).map((part): TableAlignment => {
      const value = part.trim();
      if (value.startsWith(":") && value.endsWith(":")) return "center";
      if (value.endsWith(":")) return "right";
      return "left";
    })
    : [];
  const tableRows = [
    ...(header ? [{ node: header, values: tableCells(state, header), header: true }] : []),
    ...rows.map((row) => ({ node: row, values: tableCells(state, row), header: false })),
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

function inlineHtmlRange(state: EditorState, node: SyntaxNode) {
  const tag = htmlTag(state.sliceDoc(node.from, node.to));
  if (!tag || tag.closing || !allowedHtmlTags.has(tag.name)) return null;
  if (tag.selfClosing || voidHtmlTags.has(tag.name)) return { from: node.from, to: node.to };

  const siblings = node.parent?.getChildren("HTMLTag") ?? [];
  const index = siblings.findIndex((candidate) => candidate.from === node.from && candidate.to === node.to);
  let depth = 0;
  for (const candidate of siblings.slice(index + 1)) {
    const candidateTag = htmlTag(state.sliceDoc(candidate.from, candidate.to));
    if (!candidateTag || candidateTag.name !== tag.name) continue;
    if (!candidateTag.closing && !candidateTag.selfClosing) {
      depth += 1;
    } else if (candidateTag.closing && depth > 0) {
      depth -= 1;
    } else if (candidateTag.closing) {
      return { from: node.from, to: candidate.to };
    }
  }
  return null;
}

function htmlBlockDecorations(state: EditorState, node: SyntaxNode) {
  const firstLine = state.doc.lineAt(node.from);
  const decorations: Array<{ from: number; to: number; decoration: Decoration }> = [{
    from: node.from,
    to: Math.min(firstLine.to, node.to),
    decoration: Decoration.replace({ widget: new HtmlWidget(state.sliceDoc(node.from, node.to), true) }),
  }];
  for (let number = firstLine.number + 1; number <= state.doc.lineAt(node.to).number; number += 1) {
    const line = state.doc.line(number);
    decorations.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: "hidden" }) });
    if (line.to > line.from) {
      decorations.push({ from: line.from, to: line.to, decoration: Decoration.replace({}) });
    }
  }
  return decorations;
}

function codeBlockLineDecorations(state: EditorState, node: SyntaxNode) {
  const firstLine = state.doc.lineAt(node.from);
  const lastLine = state.doc.lineAt(node.to);
  const decorations: Array<{ from: number; to: number; decoration: Decoration }> = [];
  for (let number = firstLine.number; number <= lastLine.number; number += 1) {
    const line = state.doc.line(number);
    const edgeClass = number === firstLine.number
      ? " cm-codeblock-first"
      : number === lastLine.number
        ? " cm-codeblock-last"
        : "";
    decorations.push({
      from: line.from,
      to: line.from,
      decoration: Decoration.line({
        class: `cm-codeblock-line${edgeClass}`,
        attributes: { "data-code-block-line": "" },
      }),
    });
  }
  return decorations;
}

type RichPreviewRange = {
  from: number;
  to: number;
  source: string;
  kind: "math" | "mermaid";
  block: boolean;
};

function overlaps(from: number, to: number, range: { from: number; to: number }) {
  return from < range.to && to > range.from;
}

function richPreviewRanges(state: EditorState) {
  const excluded: Array<{ from: number; to: number }> = [];
  const ranges: RichPreviewRange[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") {
        excluded.push({ from: node.from, to: node.to });
      }
      if (node.name !== "FencedCode") return;
      const firstLine = state.doc.lineAt(node.from);
      const fence = firstLine.text.match(/^\s*(```|~~~)\s*mermaid\s*$/i)?.[1];
      if (!fence) return;
      const lastLine = state.doc.lineAt(node.to);
      if (lastLine.text.trim() !== fence) return;
      const contentFrom = Math.min(firstLine.to + 1, node.to);
      const contentTo = Math.max(contentFrom, lastLine.from - 1);
      ranges.push({
        from: firstLine.from,
        to: lastLine.to,
        source: state.sliceDoc(contentFrom, contentTo),
        kind: "mermaid",
        block: true,
      });
    },
  });

  const unavailable = (from: number, to: number) =>
    excluded.some((range) => overlaps(from, to, range)) || ranges.some((range) => overlaps(from, to, range));

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (line.text.trim() !== "$$" || unavailable(line.from, line.to)) continue;
    for (let closingNumber = lineNumber + 1; closingNumber <= state.doc.lines; closingNumber += 1) {
      const closingLine = state.doc.line(closingNumber);
      if (closingLine.text.trim() !== "$$") continue;
      if (unavailable(line.from, closingLine.to)) break;
      ranges.push({
        from: line.from,
        to: closingLine.to,
        source: state.sliceDoc(line.to + 1, closingLine.from - 1),
        kind: "math",
        block: true,
      });
      lineNumber = closingNumber;
      break;
    }
  }

  const text = state.doc.toString();
  for (const match of text.matchAll(/\$\$([^$\n]+?)\$\$|\$([^$\n]+?)\$/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (isEscaped(text, from) || unavailable(from, to)) continue;
    ranges.push({
      from,
      to,
      source: match[1] ?? match[2],
      kind: "math",
      block: match[1] !== undefined,
    });
  }
  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function isEscaped(text: string, position: number) {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function richPreviewDecorations(state: EditorState, range: RichPreviewRange) {
  if (!range.block) {
    return [{
      from: range.from,
      to: range.to,
      decoration: Decoration.replace({ widget: new MathWidget(range.source, false) }),
    }];
  }
  const firstLine = state.doc.lineAt(range.from);
  const lastLine = state.doc.lineAt(range.to);
  const widget = range.kind === "mermaid"
    ? new MermaidWidget(range.source)
    : new MathWidget(range.source, true);
  const decorations: Array<{ from: number; to: number; decoration: Decoration }> = [{
    from: range.from,
    to: Math.min(firstLine.to, range.to),
    decoration: Decoration.replace({ widget }),
  }];
  for (let number = firstLine.number + 1; number <= lastLine.number; number += 1) {
    const line = state.doc.line(number);
    decorations.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: "hidden" }) });
    if (line.to > line.from) decorations.push({ from: line.from, to: line.to, decoration: Decoration.replace({}) });
  }
  return decorations;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const richRanges = richPreviewRanges(view.state);
  const inactiveRichRanges = richRanges.filter((range) =>
    !rangeIsActive(range.from, range.to, view.state.selection.ranges, view.composing));
  inactiveRichRanges.forEach((range) => ranges.push(...richPreviewDecorations(view.state, range)));
  for (const viewport of view.visibleRanges) {
    let htmlPreviewTo = -1;
    syntaxTree(view.state).iterate({
      from: viewport.from,
      to: viewport.to,
      enter(node) {
        if (inactiveRichRanges.some((range) => node.from >= range.from && node.to <= range.to)) return false;
        const activeNode = node.name === "Escape" || node.node.parent?.name === "Document"
          ? node.node
          : node.node.parent ?? node.node;
        const active = nodeIsActive(view.state, activeNode, view.composing);
        if (node.name === "FencedCode") {
          ranges.push(...codeBlockLineDecorations(view.state, node.node));
        }
        if (!active && node.name === "HTMLBlock") {
          ranges.push(...htmlBlockDecorations(view.state, node.node));
          return false;
        }
        if (node.name === "HTMLTag" && node.from >= htmlPreviewTo) {
          const range = inlineHtmlRange(view.state, node.node);
          if (range) {
            htmlPreviewTo = range.to;
            if (!rangeIsActive(range.from, range.to, view.state.selection.ranges, view.composing)) {
              ranges.push({
                ...range,
                decoration: Decoration.replace({ widget: new HtmlWidget(view.state.sliceDoc(range.from, range.to), false) }),
              });
            }
          }
          return false;
        }
        if (!active && node.name === "Table") {
          const table = tableDecorations(view.state, node.node);
          ranges.push(...table.rows);
          if (table.separator) {
            ranges.push({
              from: table.separator.from,
              to: table.separator.from,
              decoration: Decoration.line({ class: "hidden", attributes: { style: "display: none" } }),
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
          const linkUrl = node.name === "Link"
            ? node.node.getChild("URL")
            : node.name === "URL"
              ? node.node
              : null;
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.mark({
              class: style,
              attributes: linkUrl
                ? { "data-link-url": view.state.sliceDoc(linkUrl.from, linkUrl.to) }
                : undefined,
            }),
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
        } else if (!active && node.name === "Escape") {
          ranges.push({ from: node.from, to: node.from + 1, decoration: Decoration.replace({ inclusive: false }) });
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
