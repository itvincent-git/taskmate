import { ensureSyntaxTree, forceParsing, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { StateField, StateEffect, type EditorState, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import { full as emoji } from "markdown-it-emoji";
import { api } from "../lib/api";

const markdownRenderer = new MarkdownIt({ html: false, linkify: true });
markdownRenderer.use(emoji);

const refreshLivePreview = StateEffect.define<null>();
const previewRefreshDelay = 75;

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
  SetextHeading1: "text-[1.85em] font-[760] leading-[1.45] no-underline",
  SetextHeading2: "text-[1.52em] font-[730] leading-[1.5] no-underline",
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
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "mark", "ol",
  "p", "pre", "q", "s", "small", "span", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul",
]);

const voidHtmlTags = new Set(["br", "hr", "img"]);

const htmlTagClasses: Partial<Record<string, string>> = {
  a: "text-accent underline underline-offset-2",
  blockquote: "my-2 border-l-3 border-line pl-3 text-muted",
  code: "rounded border border-line bg-surface-soft px-1 py-px font-mono text-[.9em]",
  del: "text-muted line-through",
  details: "my-2 rounded-md border border-line px-3 py-2",
  h1: "my-2 text-[1.85em] font-[760] leading-[1.45]",
  h2: "my-2 text-[1.52em] font-[730] leading-[1.5]",
  h3: "my-2 text-[1.3em] font-bold",
  h4: "my-2 font-bold",
  h5: "my-2 font-bold",
  h6: "my-2 font-bold",
  hr: "my-3 border-0 border-t border-line",
  em: "italic",
  img: "my-2 block max-h-[360px] max-w-[min(100%,560px)] rounded-lg border border-line object-contain",
  kbd: "rounded border border-line bg-surface-soft px-1.5 py-0.5 font-mono text-[.85em] shadow-sm",
  mark: "rounded bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] px-0.5 text-inherit",
  ol: "my-2 list-decimal pl-6",
  pre: "my-2 overflow-x-auto rounded-md bg-surface-soft p-3 font-mono text-[.9em]",
  summary: "cursor-pointer font-semibold",
  strong: "font-[750]",
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
  return /^(?:https?:|mailto:|#)/i.test(value) ? value : null;
}

function safeImageSource(value: string) {
  const source = value.trim();
  if (/^(?:https?:|blob:)/i.test(source)) return source;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(source)) return source;
  if (!source || source.startsWith("/") || source.startsWith("//") || /^[A-Za-z][\w+.-]*:/.test(source)) return null;
  return source.split(/[\\/]/).includes("..") ? null : source;
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
  const align = node.getAttribute("align")?.toLowerCase();
  if (align && ["left", "center", "right", "justify"].includes(align)) element.setAttribute("align", align);
  const direction = node.getAttribute("dir")?.toLowerCase();
  if (direction && ["ltr", "rtl", "auto"].includes(direction)) element.setAttribute("dir", direction);
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
    const title = node.getAttribute("title");
    if (title !== null) element.setAttribute("title", title);
  }
  if (tag === "img") {
    const source = safeImageSource(node.getAttribute("src") ?? "");
    const alt = node.getAttribute("alt");
    const title = node.getAttribute("title");
    if (alt !== null) element.setAttribute("alt", alt);
    if (title !== null) element.setAttribute("title", title);
    const width = node.getAttribute("width");
    if (width && /^\d+$/.test(width)) element.setAttribute("width", width);
    if (source) {
      void api.resolveAttachment(source)
        .then((resolved) => { element.setAttribute("src", resolved); })
        .catch(() => undefined);
    }
  }
  return element;
}

function appendMarkdown(parent: HTMLElement, source: string, inline = false) {
  const html = inline ? markdownRenderer.renderInline(source) : markdownRenderer.render(source);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.body.childNodes.forEach((child) => {
    const sanitized = sanitizedHtmlNode(child);
    if (sanitized) parent.append(sanitized);
  });
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

class HtmlContainerWidget extends WidgetType {
  constructor(
    readonly tag: string,
    readonly openingSource: string,
    readonly markdownSource: string,
  ) {
    super();
  }
  eq(other: HtmlContainerWidget) {
    return this.tag === other.tag
      && this.openingSource === other.openingSource
      && this.markdownSource === other.markdownSource;
  }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-html-preview cm-html-preview-block";
    wrapper.dataset.previewKind = "html-container";
    const parsed = new DOMParser().parseFromString(`${this.openingSource}</${this.tag}>`, "text/html");
    const container = Array.from(parsed.body.children)
      .map((child) => sanitizedHtmlNode(child))
      .find((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === this.tag);
    if (container) {
      appendMarkdown(container, this.markdownSource);
      wrapper.append(container);
    }
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

class ParagraphWidget extends WidgetType {
  constructor(readonly source: string, readonly references: readonly string[]) {
    super();
  }
  eq(other: ParagraphWidget) {
    return this.source === other.source && JSON.stringify(this.references) === JSON.stringify(other.references);
  }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-paragraph-preview block [&>p]:m-0";
    wrapper.dataset.previewKind = "paragraph";
    appendMarkdown(wrapper, [this.source, ...this.references].join("\n\n"));
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

const mathCache = new Map<string, string>();

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
    const key = `${this.block}:${this.source}`;
    let html = mathCache.get(key);
    if (html === undefined) {
      html = katex.renderToString(this.source, { displayMode: this.block, throwOnError: false, trust: false });
      if (mathCache.size >= 64) mathCache.delete(mathCache.keys().next().value!);
      mathCache.set(key, html);
    }
    wrapper.innerHTML = html;
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

let mermaidId = 0;

class MermaidWidget extends WidgetType {
  private dom?: HTMLElement;
  constructor(readonly source: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return this.source === other.source;
  }
  toDOM(view: EditorView) {
    if (this.dom && !this.dom.isConnected) return this.dom;
    const wrapper = document.createElement("span");
    this.dom = wrapper;
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
  const references = linkReferences(state);
  for (const bias of [1, -1] as const) {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, bias);
    while (node && node.name !== "Link" && node.name !== "Autolink" && node.name !== "URL") {
      node = node.parent;
    }
    if (!node) continue;
    const url = node.name === "Link" ? linkDestination(state, node, references) : node.getChild("URL") ?? node;
    if (typeof url === "string") return url;
    if (url) return state.sliceDoc(url.from, url.to);
  }
  return null;
}

function normalizedLinkLabel(value: string) {
  return value.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedLinkDestination(value: string) {
  const destination = value.trim();
  return destination.startsWith("<") && destination.endsWith(">")
    ? destination.slice(1, -1)
    : destination;
}

type LinkReference = { destination: string; title?: string };

function normalizedLinkTitle(value: string) {
  const title = value.trim();
  const unquoted = title.length >= 2 && (
    (title.startsWith('"') && title.endsWith('"'))
    || (title.startsWith("'") && title.endsWith("'"))
    || (title.startsWith("(") && title.endsWith(")"))
  ) ? title.slice(1, -1) : title;
  const parsed = new DOMParser().parseFromString(markdownRenderer.renderInline(unquoted), "text/html");
  return parsed.body.textContent ?? unquoted;
}

function linkReferences(state: EditorState) {
  const references = new Map<string, LinkReference>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "LinkReference") return;
      const label = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (!label || !url) return;
      const key = normalizedLinkLabel(state.sliceDoc(label.from, label.to));
      if (!references.has(key)) {
        const title = node.node.getChild("LinkTitle");
        references.set(key, {
          destination: normalizedLinkDestination(state.sliceDoc(url.from, url.to)),
          title: title ? normalizedLinkTitle(state.sliceDoc(title.from, title.to)) : undefined,
        });
      }
    },
  });
  return references;
}

function linkReference(
  state: EditorState,
  link: SyntaxNode,
  references: ReadonlyMap<string, LinkReference>,
) {
  if (link.getChild("URL")) return undefined;
  const label = link.getChild("LinkLabel");
  const explicitLabel = label ? state.sliceDoc(label.from, label.to) : "";
  if (label && explicitLabel !== "[]") return references.get(normalizedLinkLabel(explicitLabel));

  const marks = link.getChildren("LinkMark");
  if (marks.length < 2) return undefined;
  return references.get(normalizedLinkLabel(`[${state.sliceDoc(marks[0].to, marks[1].from)}]`));
}

function linkDestination(state: EditorState, link: SyntaxNode, references: ReadonlyMap<string, LinkReference>) {
  const inlineUrl = link.getChild("URL");
  if (inlineUrl) return state.sliceDoc(inlineUrl.from, inlineUrl.to);
  return linkReference(state, link, references)?.destination;
}

function linkTitle(state: EditorState, link: SyntaxNode, references: ReadonlyMap<string, LinkReference>) {
  const inlineTitle = link.getChild("LinkTitle");
  if (inlineTitle) return normalizedLinkTitle(state.sliceDoc(inlineTitle.from, inlineTitle.to));
  return linkReference(state, link, references)?.title;
}

function imageAlt(state: EditorState, image: SyntaxNode) {
  const marks = image.getChildren("LinkMark");
  if (marks.length < 2) return "";
  const source = state.sliceDoc(marks[0].to, marks[1].from);
  const parsed = new DOMParser().parseFromString(markdownRenderer.renderInline(source), "text/html");
  return parsed.body.textContent ?? source;
}

function nodeIsActive(state: EditorState, node: SyntaxNode, composing: boolean) {
  return rangeIsActive(node.from, node.to, state.selection.ranges, composing);
}

export function documentHeadings(state: EditorState, complete = false) {
  const tree = complete ? ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state) : syntaxTree(state);
  const headings: Array<{ from: number; to: number; level: number; text: string; id: string }> = [];
  const used = new Set<string>();
  const references = linkReferences(state);
  const plainText = (parts: TableCellContent[]): string => parts.map((part) =>
    part.text ?? plainText(part.children ?? [])).join("");
  tree.iterate({
    enter(node) {
      const match = node.name.match(/^(?:ATX|Setext)Heading([1-6])$/);
      if (!match) return;
      const text = plainText(tableCellContent(state, node.node, references)).trim().replace(/\s+/g, " ");
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
      let id = base;
      for (let suffix = 1; used.has(id); suffix += 1) id = `${base}-${suffix}`;
      used.add(id);
      headings.push({ from: node.from, to: node.to, level: Number(match[1]), text, id });
      return false;
    },
  });
  return headings;
}

export function navigateToFragment(view: EditorView, url: string) {
  if (!url.startsWith("#")) return false;
  let id: string;
  try {
    id = decodeURIComponent(url.slice(1));
  } catch {
    return true;
  }
  const target = id ? documentHeadings(view.state, true).find((heading) => heading.id === id)?.from : 0;
  if (target !== undefined) {
    view.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: "start" }) });
    view.focus();
  }
  return true;
}

class TocWidget extends WidgetType {
  constructor(readonly headings: ReturnType<typeof documentHeadings>) {
    super();
  }
  eq(other: TocWidget) {
    return JSON.stringify(this.headings) === JSON.stringify(other.headings);
  }
  toDOM(view: EditorView) {
    const nav = document.createElement("nav");
    nav.dataset.previewKind = "toc";
    nav.setAttribute("aria-label", "Table of contents");
    nav.className = "my-2 rounded-md border border-line bg-surface-soft p-3";
    const list = document.createElement("ol");
    list.className = "m-0 list-none p-0";
    const baseLevel = Math.min(...this.headings.map((heading) => heading.level));
    this.headings.forEach((heading) => {
      const item = document.createElement("li");
      item.dataset.headingLevel = String(heading.level);
      item.style.marginInlineStart = `${(heading.level - baseLevel) * 16}px`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cursor-pointer border-0 bg-transparent p-0 text-left text-accent hover:underline";
      button.textContent = heading.text;
      button.dataset.tocTarget = heading.id;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => navigateToFragment(view, `#${encodeURIComponent(heading.id)}`));
      item.append(button);
      list.append(item);
    });
    nav.append(list);
    return nav;
  }
  ignoreEvent() {
    return true;
  }
}

type AdmonitionType = "note" | "tip" | "important" | "warning" | "caution";

const admonitionDetails: Record<AdmonitionType, { label: string; className: string }> = {
  note: { label: "Note", className: "border-accent" },
  tip: { label: "Tip", className: "border-success" },
  important: { label: "Important", className: "border-[color-mix(in_srgb,var(--accent)_70%,var(--line))]" },
  warning: { label: "Warning", className: "border-warning" },
  caution: { label: "Caution", className: "border-danger" },
};

class AdmonitionWidget extends WidgetType {
  constructor(readonly type: AdmonitionType, readonly source: string) {
    super();
  }
  eq(other: AdmonitionWidget) {
    return this.type === other.type && this.source === other.source;
  }
  toDOM() {
    const details = admonitionDetails[this.type];
    const aside = document.createElement("aside");
    aside.className = `my-2 block rounded-md border border-l-4 bg-surface-soft px-3 py-2 ${details.className}`;
    aside.dataset.previewKind = "admonition";
    aside.dataset.admonitionType = this.type;
    const title = document.createElement("span");
    title.className = "mb-1 block font-[750]";
    title.textContent = details.label;
    const content = document.createElement("span");
    content.className = "block [&>:first-child]:mt-0 [&>:last-child]:mb-0";
    appendMarkdown(content, this.source);
    aside.append(title, content);
    return aside;
  }
}

class DefinitionListWidget extends WidgetType {
  constructor(readonly term: string, readonly definitions: string[]) {
    super();
  }
  eq(other: DefinitionListWidget) {
    return this.term === other.term && JSON.stringify(this.definitions) === JSON.stringify(other.definitions);
  }
  toDOM() {
    const list = document.createElement("dl");
    list.className = "my-2 block";
    list.dataset.previewKind = "definition-list";
    const term = document.createElement("dt");
    term.className = "font-[750]";
    appendMarkdown(term, this.term, true);
    list.append(term);
    this.definitions.forEach((source) => {
      const definition = document.createElement("dd");
      definition.className = "ml-5 text-muted";
      appendMarkdown(definition, source, true);
      list.append(definition);
    });
    return list;
  }
}

class FootnoteDefinitionWidget extends WidgetType {
  constructor(readonly label: string, readonly number: number, readonly source: string) {
    super();
  }
  eq(other: FootnoteDefinitionWidget) {
    return this.label === other.label && this.number === other.number && this.source === other.source;
  }
  toDOM() {
    const footnote = document.createElement("span");
    footnote.className = "my-1 grid grid-cols-[auto_1fr] gap-2 text-[.92em] text-muted";
    footnote.dataset.previewKind = "footnote-definition";
    footnote.dataset.footnoteLabel = this.label;
    footnote.setAttribute("role", "doc-footnote");
    const marker = document.createElement("span");
    marker.className = "font-[750] text-accent";
    marker.textContent = `${this.number}.`;
    const content = document.createElement("span");
    content.className = "min-w-0 [&>:first-child]:mt-0 [&>:last-child]:mb-0";
    appendMarkdown(content, this.source);
    footnote.append(marker, content);
    return footnote;
  }
}

class FootnoteReferenceWidget extends WidgetType {
  constructor(readonly label: string, readonly number: number) {
    super();
  }
  eq(other: FootnoteReferenceWidget) {
    return this.label === other.label && this.number === other.number;
  }
  toDOM(view: EditorView) {
    const reference = document.createElement("sup");
    reference.dataset.previewKind = "footnote-reference";
    reference.dataset.footnoteLabel = this.label;
    reference.setAttribute("role", "doc-noteref");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cursor-pointer border-0 bg-transparent p-0 text-accent hover:underline";
    button.textContent = String(this.number);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const target = extensionPreviewRanges(view.state, richPreviewRanges(view.state))
        .find((range) => range.widget instanceof FootnoteDefinitionWidget && range.widget.label === this.label)?.from;
      if (target === undefined) return;
      view.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: "center" }) });
      view.focus();
    });
    reference.append(button);
    return reference;
  }
  ignoreEvent() {
    return false;
  }
}

class EmojiWidget extends WidgetType {
  constructor(readonly source: string, readonly value: string) {
    super();
  }
  eq(other: EmojiWidget) {
    return this.source === other.source && this.value === other.value;
  }
  toDOM() {
    const emojiNode = document.createElement("span");
    emojiNode.dataset.previewKind = "emoji";
    emojiNode.setAttribute("role", "img");
    emojiNode.setAttribute("aria-label", this.source.slice(1, -1).replaceAll("_", " "));
    emojiNode.textContent = this.value;
    return emojiNode;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly alt: string,
    readonly title?: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return this.source === other.source && this.alt === other.alt && this.title === other.title;
  }
  toDOM() {
    const image = document.createElement("img");
    image.className = "my-2 block max-h-[360px] max-w-[min(100%,560px)] rounded-lg border border-line object-contain";
    image.dataset.previewKind = "image";
    image.alt = this.alt;
    if (this.title) image.title = this.title;
    void api.resolveAttachment(this.source).then((source) => { image.src = source; }).catch(() => {
      image.className = "my-2 block min-h-[72px] max-h-[360px] min-w-[180px] max-w-[min(100%,560px)] rounded-lg border border-line bg-surface-soft p-3 object-contain text-muted";
      image.title ||= `Unable to load attachment: ${this.source}`;
    });
    return image;
  }
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
    readonly kind: "bullet" | "ordered" | "task" | "quote" | "rule",
    readonly text = "",
    readonly from = 0,
  ) {
    super();
  }
  eq(other: MarkerWidget) {
    return this.kind === other.kind && this.text === other.text && this.from === other.from;
  }
  toDOM(view: EditorView) {
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
          changes: { from: view.posAtDOM(checkbox), to: view.posAtDOM(checkbox) + this.text.length, insert: checked ? "[ ]" : "[x]" },
          effects: refreshLivePreview.of(null),
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

function tableCellContent(state: EditorState, cell: SyntaxNode, references: ReadonlyMap<string, LinkReference>): TableCellContent[] {
  const parts: TableCellContent[] = [];
  let position = cell.from;
  for (let child = cell.firstChild; child; child = child.nextSibling) {
    if (child.from > position) parts.push({ text: state.sliceDoc(position, child.from) });
    if (child.name === "Escape") {
      parts.push({ text: state.sliceDoc(child.from + 1, child.to) });
    } else if (
      !hiddenMarks.has(child.name) &&
      !(child.name === "URL" && cell.name === "Link") &&
      !(child.name === "LinkLabel" && cell.name === "Link")
    ) {
      const className = styledNodes[child.name];
      const url = child.name === "Link"
        ? linkDestination(state, child, references)
        : child.name === "URL"
          ? child
          : null;
      if (className || child.firstChild) {
        parts.push({
          className,
          linkUrl: typeof url === "string" ? url : url ? state.sliceDoc(url.from, url.to) : undefined,
          children: tableCellContent(state, child, references),
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

function tableCells(state: EditorState, row: SyntaxNode, references: ReadonlyMap<string, LinkReference>) {
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
    return cell ? tableCellContent(state, cell, references) : [];
  });
}

function tableDecorations(state: EditorState, node: SyntaxNode, references: ReadonlyMap<string, LinkReference>) {
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
    ...(header ? [{ node: header, values: tableCells(state, header, references), header: true }] : []),
    ...rows.map((row) => ({ node: row, values: tableCells(state, row, references), header: false })),
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
  return [{ from: node.from, to: node.to, decoration: Decoration.replace({
    widget: new HtmlWidget(state.sliceDoc(node.from, node.to), true), block: true,
  }) }];
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
  widget?: WidgetType;
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

type ExtensionPreviewRange = {
  from: number;
  to: number;
  block: boolean;
  widget: WidgetType;
};

function htmlContainerPreviewRanges(state: EditorState, tree: ReturnType<typeof syntaxTree>) {
  const blocks: Array<{ from: number; to: number; source: string }> = [];
  tree.iterate({
    enter(node) {
      if (node.name === "HTMLBlock") {
        blocks.push({ from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to) });
        return false;
      }
    },
  });
  const stack: Array<{ tag: string; from: number; to: number; source: string }> = [];
  const ranges: ExtensionPreviewRange[] = [];
  blocks.forEach((block) => {
    const closing = block.source.trim().match(/^<\s*\/\s*([A-Za-z][\w:-]*)\s*>$/);
    if (closing) {
      const tag = closing[1].toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].tag !== tag) index -= 1;
      if (index < 0) return;
      const opening = stack[index];
      stack.splice(index);
      ranges.push({
        from: opening.from,
        to: block.to,
        block: true,
        widget: new HtmlContainerWidget(tag, opening.source, state.sliceDoc(opening.to, block.from)),
      });
      return;
    }

    const opening = block.source.match(/^<\s*([A-Za-z][\w:-]*)\b[^>]*>/s);
    if (!opening) return;
    const tag = opening[1].toLowerCase();
    if (!allowedHtmlTags.has(tag) || voidHtmlTags.has(tag)) return;
    if (new RegExp(`<\\s*\\/\\s*${tag}\\s*>`, "i").test(block.source)) return;
    stack.push({ tag, ...block });
  });
  return ranges;
}

function extensionPreviewRanges(state: EditorState, richRanges: readonly RichPreviewRange[]) {
  const blockExcluded: Array<{ from: number; to: number }> = [];
  const inlineExcluded: Array<{ from: number; to: number }> = [...richRanges];
  const tree = syntaxTree(state);
  const blockRanges = htmlContainerPreviewRanges(state, tree);
  tree.iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"].includes(node.name)) {
        const range = { from: node.from, to: node.to };
        blockExcluded.push(range);
        inlineExcluded.push(range);
        return false;
      }
      if (["InlineCode", "HTMLTag", "Comment", "URL"].includes(node.name)) {
        inlineExcluded.push({ from: node.from, to: node.to });
      }
    },
  });

  if (state.doc.lines > 1 && state.doc.line(1).text.trim() === "---") {
    for (let number = 2; number <= state.doc.lines; number += 1) {
      const line = state.doc.line(number);
      if (line.text.trim() !== "---") continue;
      const range = { from: 0, to: line.to };
      blockExcluded.push(range);
      inlineExcluded.push(range);
      break;
    }
  }

  const blockUnavailable = (from: number, to: number) =>
    blockExcluded.some((range) => overlaps(from, to, range))
    || blockRanges.some((range) => overlaps(from, to, range));
  const footnotes = new Map<string, { number: number }>();

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const match = line.text.match(/^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
    if (!match || blockUnavailable(line.from, line.to)) continue;
    const content = [match[2]];
    let to = line.to;
    let nextNumber = lineNumber + 1;
    while (nextNumber <= state.doc.lines) {
      const next = state.doc.line(nextNumber);
      if (/^(?: {4}|\t)/.test(next.text)) {
        content.push(next.text.replace(/^(?: {4}|\t)/, ""));
        to = next.to;
        nextNumber += 1;
        continue;
      }
      if (!next.text.trim() && nextNumber < state.doc.lines) {
        const afterBlank = state.doc.line(nextNumber + 1);
        if (/^(?: {4}|\t)/.test(afterBlank.text)) {
          content.push("");
          to = next.to;
          nextNumber += 1;
          continue;
        }
      }
      break;
    }
    const label = match[1].toLowerCase();
    const entry = footnotes.get(label) ?? { number: footnotes.size + 1 };
    footnotes.set(label, entry);
    blockRanges.push({
      from: line.from,
      to,
      block: true,
      widget: new FootnoteDefinitionWidget(label, entry.number, content.join("\n")),
    });
    lineNumber = state.doc.lineAt(to).number;
  }

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const admonition = line.text.match(/^ {0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
    if (admonition && !blockUnavailable(line.from, line.to)) {
      const content: string[] = [];
      let to = line.to;
      let nextNumber = lineNumber + 1;
      while (nextNumber <= state.doc.lines) {
        const next = state.doc.line(nextNumber);
        const quote = next.text.match(/^ {0,3}> ?(.*)$/);
        if (!quote) break;
        content.push(quote[1]);
        to = next.to;
        nextNumber += 1;
      }
      blockRanges.push({
        from: line.from,
        to,
        block: true,
        widget: new AdmonitionWidget(admonition[1].toLowerCase() as AdmonitionType, content.join("\n")),
      });
      lineNumber = state.doc.lineAt(to).number;
      continue;
    }

    if (!line.text.trim() || lineNumber >= state.doc.lines) continue;
    const definitions: string[] = [];
    let to = line.to;
    let nextNumber = lineNumber + 1;
    while (nextNumber <= state.doc.lines) {
      const next = state.doc.line(nextNumber);
      const definition = next.text.match(/^ {0,3}:\s+(.+)$/);
      if (!definition) break;
      definitions.push(definition[1]);
      to = next.to;
      nextNumber += 1;
    }
    if (!definitions.length || blockUnavailable(line.from, to)) continue;
    blockRanges.push({
      from: line.from,
      to,
      block: true,
      widget: new DefinitionListWidget(line.text.trim(), definitions),
    });
    lineNumber = state.doc.lineAt(to).number;
  }

  const referenceSources: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "LinkReference") {
        referenceSources.push(state.sliceDoc(node.from, node.to));
        return false;
      }
    },
  });
  tree.iterate({
    enter(node) {
      if (node.name !== "Paragraph" || !state.sliceDoc(node.from, node.to).includes("\n")) return;
      const source = state.sliceDoc(node.from, node.to);
      if (
        blockUnavailable(node.from, node.to)
        || inlineExcluded.some((range) => overlaps(node.from, node.to, range))
        || /\[\^[^\]\s]+\]|:[a-z0-9_+-]+:/i.test(source)
      ) return false;
      blockRanges.push({
        from: node.from,
        to: node.to,
        block: true,
        widget: new ParagraphWidget(source, referenceSources),
      });
      return false;
    },
  });

  const ranges = [...blockRanges];
  const unavailable = (from: number, to: number) =>
    inlineExcluded.some((range) => overlaps(from, to, range))
    || blockRanges.some((range) => overlaps(from, to, range));
  const text = state.doc.toString();
  for (const match of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const footnote = footnotes.get(match[1].toLowerCase());
    if (!footnote || unavailable(from, to) || isEscaped(text, from)) continue;
    ranges.push({
      from,
      to,
      block: false,
      widget: new FootnoteReferenceWidget(match[1].toLowerCase(), footnote.number),
    });
  }
  for (const match of text.matchAll(/:([a-z0-9_+-]+):/gi)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (unavailable(from, to) || isEscaped(text, from)) continue;
    const value = markdownRenderer.renderInline(match[0]);
    if (value === match[0]) continue;
    ranges.push({ from, to, block: false, widget: new EmojiWidget(match[0], value) });
  }
  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function extensionPreviewDecorations(_state: EditorState, range: ExtensionPreviewRange) {
  return [{ from: range.from, to: range.to, decoration: Decoration.replace({ widget: range.widget, block: range.block }) }];
}

function richPreviewDecorations(_state: EditorState, range: RichPreviewRange) {
  const widget = range.widget ??= range.kind === "mermaid"
    ? new MermaidWidget(range.source)
    : new MathWidget(range.source, range.block);
  return [{ from: range.from, to: range.to, decoration: Decoration.replace({ widget, block: range.block }) }];
}

function previewIndex(state: EditorState) {
  const rich = richPreviewRanges(state);
  const plain: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === "Paragraph" && /^[\p{L}\p{N} \t\n.,!?，。！？]*$/u.test(state.sliceDoc(node.from, node.to))) {
      plain.push({ from: node.from, to: node.to });
      return false;
    }
  } });
  return {
    plain,
    tree: syntaxTree(state),
    rich,
    extensions: extensionPreviewRanges(state, rich),
    references: linkReferences(state),
    headings: new Map(documentHeadings(state).map((heading) => [heading.from, heading])),
  };
}
type PreviewIndex = ReturnType<typeof previewIndex>;

function buildDecorations(state: EditorState, index: PreviewIndex, area = { from: 0, to: state.doc.length }): DecorationSet {
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const { rich: richRanges, extensions: extensionRanges, references, headings } = index;
  const inactiveRichRanges = richRanges.filter((range) =>
    !rangeIsActive(range.from, range.to, state.selection.ranges, false));
  const inactiveExtensionRanges = extensionRanges.filter((range) =>
    !rangeIsActive(range.from, range.to, state.selection.ranges, false));
  const activeHtmlContainerRanges = extensionRanges.filter((range) =>
    range.widget instanceof HtmlContainerWidget
    && rangeIsActive(range.from, range.to, state.selection.ranges, false));
  inactiveRichRanges.forEach((range) => ranges.push(...richPreviewDecorations(state, range)));
  inactiveExtensionRanges.forEach((range) => ranges.push(...extensionPreviewDecorations(state, range)));
  for (const viewport of [area]) {
    let htmlPreviewTo = -1;
    syntaxTree(state).iterate({
      from: viewport.from,
      to: viewport.to,
      enter(node) {
        if (inactiveRichRanges.some((range) => node.from >= range.from && node.to <= range.to)) return false;
        if (inactiveExtensionRanges.some((range) => node.from >= range.from && node.to <= range.to)) return false;
        if (activeHtmlContainerRanges.some((range) => node.from >= range.from && node.to <= range.to)) return false;
        const activeNode = node.name === "Escape" || node.node.parent?.name === "Document"
          ? node.node
          : node.node.parent ?? node.node;
        const active = nodeIsActive(state, activeNode, false);
        if (node.name === "Paragraph" && /^\s*\[TOC\]\s*$/i.test(state.sliceDoc(node.from, node.to))) {
          if (!active) {
            ranges.push({
              from: node.from,
              to: node.to,
              decoration: Decoration.replace({ widget: new TocWidget([...headings.values()]) }),
            });
          }
          return false;
        }
        if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) {
          const heading = headings.get(node.from);
          if (heading) {
            ranges.push({
              from: state.doc.lineAt(node.from).from,
              to: state.doc.lineAt(node.from).from,
              decoration: Decoration.line({ attributes: { id: heading.id, "data-heading-id": heading.id } }),
            });
          }
          if (!active && node.name.startsWith("Setext")) {
            const underline = node.node.getChild("HeaderMark");
            if (underline) {
              ranges.push({
                from: state.doc.lineAt(underline.from).from - 1,
                to: underline.to,
                decoration: Decoration.replace({}),
              });
            }
          }
        }
        if (node.name === "Comment" || node.name === "CommentBlock") {
          if (!nodeIsActive(state, node.node, false)) {
            ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ block: node.name === "CommentBlock" }) });
          }
          return false;
        }
        if (node.name === "LinkReference") {
          if (!active) {
            ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ block: true }) });
          }
          return false;
        }
        if (node.name === "FencedCode") {
          ranges.push(...codeBlockLineDecorations(state, node.node));
        }
        if (!active && node.name === "HTMLBlock") {
          ranges.push(...htmlBlockDecorations(state, node.node));
          return false;
        }
        if (node.name === "HTMLTag" && node.from >= htmlPreviewTo) {
          const range = inlineHtmlRange(state, node.node);
          if (range) {
            htmlPreviewTo = range.to;
            if (!rangeIsActive(range.from, range.to, state.selection.ranges, false)) {
              const firstLine = state.doc.lineAt(range.from);
              const lastLine = state.doc.lineAt(range.to);
              if (firstLine.number !== lastLine.number) {
                ranges.push(...htmlBlockDecorations(state, node.node));
              } else {
                ranges.push({
                  ...range,
                  decoration: Decoration.replace({ widget: new HtmlWidget(state.sliceDoc(range.from, range.to), false) }),
                });
              }
            }
          }
          return false;
        }
        if (!active && node.name === "Table") {
          const table = tableDecorations(state, node.node, references);
          ranges.push(...table.rows);
          if (table.separator) {
            ranges.push({ from: table.separator.from - 1, to: table.separator.to, decoration: Decoration.replace({}) });
          }
          return false;
        }
        if (!active && node.name === "Image") {
          const destination = linkDestination(state, node.node, references);
          if (destination) {
            const source = normalizedLinkDestination(destination);
            ranges.push({
              from: node.from,
              to: node.to,
              decoration: Decoration.replace({
                widget: new ImageWidget(
                  source,
                  imageAlt(state, node.node),
                  linkTitle(state, node.node, references),
                ),
              }),
            });
          }
          return false;
        }
        if (!active && node.name === "HorizontalRule") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("rule") }) });
          return false;
        }
        const isLinkTarget = node.name === "URL" && node.node.parent?.name === "Link";
        const isLinkLabel = node.name === "LinkLabel" && node.node.parent?.name === "Link";
        const style = isLinkTarget ? undefined : styledNodes[node.name];
        if (style) {
          const linkUrl = node.name === "Link"
            ? linkDestination(state, node.node, references)
            : node.name === "URL"
              ? node.node
              : null;
          const title = node.name === "Link" ? linkTitle(state, node.node, references) : undefined;
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.mark({
              class: style,
              attributes: linkUrl ? {
                "data-link-url": typeof linkUrl === "string" ? linkUrl : state.sliceDoc(linkUrl.from, linkUrl.to),
                ...(title ? { title } : {}),
              } : undefined,
            }),
          });
        }
        if (!active && node.name === "ListMark") {
          const taskMarker = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
          if (taskMarker) {
            ranges.push({ from: node.from, to: taskMarker.from, decoration: Decoration.replace({}) });
            return;
          }
          const marker = state.sliceDoc(node.from, node.to);
          const kind = /^\d/.test(marker) ? "ordered" : "bullet";
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget(kind, marker) }) });
        } else if (!active && node.name === "TaskMarker") {
          ranges.push({
            from: node.from,
            to: node.to,
            decoration: Decoration.replace({
              widget: new MarkerWidget("task", state.sliceDoc(node.from, node.to), node.from),
            }),
          });
        } else if (!active && node.name === "QuoteMark") {
          ranges.push({ from: node.from, to: node.to, decoration: Decoration.replace({ widget: new MarkerWidget("quote") }) });
        } else if (!active && node.name === "Escape") {
          ranges.push({ from: node.from, to: node.from + 1, decoration: Decoration.replace({ inclusive: false }) });
        } else if (
          !active &&
          (hiddenMarks.has(node.name) || isLinkTarget || isLinkLabel) &&
          node.to > node.from
        ) {
          let to = node.to;
          if (
            node.name === "HeaderMark" &&
            node.node.parent &&
            /^[ \t]*$/.test(state.sliceDoc(node.node.parent.from, node.from))
          ) {
            while (/[ \t]/.test(state.sliceDoc(to, to + 1))) to += 1;
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
  return Decoration.set(ranges.filter((range) => range.from >= area.from && range.to <= area.to)
    .map(({ from, to, decoration }) => decoration.range(from, to)), true);
}

// Plain prose cannot change reference/footnote/heading dependencies. Map the
// existing index and only replace the edited paragraph's cached source.
function mapPlainIndex(index: PreviewIndex, transaction: Transaction): PreviewIndex | null {
  const touched = new Set<{ from: number; to: number }>();
  let plain = true;
  transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    const block = index.plain.find((range) => from > range.from && to <= range.to);
    if (!block || !rangeIsActive(block.from, block.to, transaction.startState.selection.ranges)
      || !rangeIsActive(transaction.changes.mapPos(block.from, -1), transaction.changes.mapPos(block.to, 1), transaction.state.selection.ranges)
      || !/^[\p{L}\p{N} \t.,!?，。！？]*$/u.test(inserted.toString())
      || transaction.startState.sliceDoc(from, to).includes("\n")) plain = false;
    else touched.add(block);
  });
  if (!plain) return null;
  const map = <T extends { from: number; to: number }>(range: T): T => ({
    ...range, from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1),
  });
  return {
    ...index,
    tree: syntaxTree(transaction.state),
    plain: index.plain.map(map),
    rich: index.rich.map(map),
    headings: new Map([...index.headings.values()].map((heading) => { const mapped = map(heading); return [mapped.from, mapped]; })),
    extensions: index.extensions.map((range) => {
      const mapped = map(range);
      if (range.widget instanceof ParagraphWidget && [...touched].some((block) => overlaps(block.from, block.to, range))) {
        mapped.widget = new ParagraphWidget(transaction.state.sliceDoc(mapped.from, mapped.to), range.widget.references);
      }
      return mapped;
    }),
  };
}

// Layout-changing replacements must be direct decorations: viewport-dependent
// replacements feed their own height changes back into viewport computation.
const composingPreview = StateEffect.define<boolean>();
function activeKey(state: EditorState, index: PreviewIndex) {
  const keys: string[] = [];
  for (const selection of state.selection.ranges) {
    for (const position of [selection.from, selection.to]) {
      for (const bias of [-1, 1] as const) {
        let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, bias);
        while (node) {
          keys.push(`${node.name}:${node.from}:${node.to}`);
          node = node.parent;
        }
      }
    }
  }
  for (const range of [...index.rich, ...index.extensions]) {
    if (rangeIsActive(range.from, range.to, state.selection.ranges)) keys.push(`${range.from}:${range.to}`);
  }
  return keys.join("|");
}

function selectionAreas(state: EditorState, index: PreviewIndex) {
  const areas: Array<{ from: number; to: number }> = [];
  for (const selection of state.selection.ranges) {
    syntaxTree(state).iterate({ from: selection.from, to: selection.to, enter(node) {
      if (node.name === "Document") return;
      areas.push({ from: node.from, to: node.to });
      return false;
    } });
  }
  for (const range of [...index.rich, ...index.extensions]) {
    if (rangeIsActive(range.from, range.to, state.selection.ranges)) areas.push({ from: range.from, to: range.to });
  }
  return areas;
}

function updateSelectionDecorations(value: DecorationSet, transaction: Transaction, index: PreviewIndex) {
  const areas = [...selectionAreas(transaction.startState, index), ...selectionAreas(transaction.state, index)]
    .sort((left, right) => left.from - right.from);
  const merged: typeof areas = [];
  for (const area of areas) {
    const previous = merged.at(-1);
    if (previous && area.from <= previous.to) previous.to = Math.max(previous.to, area.to);
    else merged.push({ ...area });
  }
  const add = merged.flatMap((area) => {
    const ranges = [];
    for (let cursor = buildDecorations(transaction.state, index, area).iter(); cursor.value; cursor.next()) {
      ranges.push(cursor.value.range(cursor.from, cursor.to));
    }
    return ranges;
  });
  return value.update({
    filter: (from, to) => !merged.some((area) => from >= area.from && to <= area.to),
    add, sort: true,
  });
}

const previewState = StateField.define<{
  decorations: DecorationSet;
  index: PreviewIndex;
  active: string;
  composing: boolean;
  pending: boolean;
}>({
  create(state) {
    const index = previewIndex(state);
    return { decorations: buildDecorations(state, index), index, active: activeKey(state, index), composing: false, pending: false };
  },
  update(value, transaction) {
    const composition = transaction.effects.find((effect) => effect.is(composingPreview));
    const composing = composition ? composition.value as boolean : value.composing;
    const refresh = transaction.effects.some((effect) => effect.is(refreshLivePreview));
    if ((transaction.docChanged && !refresh) || composing) {
      const mapped = transaction.docChanged && !value.pending ? mapPlainIndex(value.index, transaction) : null;
      const index = mapped ?? value.index;
      return { ...value, index, composing, pending: value.pending || (transaction.docChanged && !mapped),
        active: mapped ? activeKey(transaction.state, index) : value.active,
        decorations: value.decorations.map(transaction.changes) };
    }
    if (!refresh && !transaction.selection && !composition) return value;
    const index = value.pending || transaction.docChanged || value.index.tree !== syntaxTree(transaction.state) ? previewIndex(transaction.state) : value.index;
    const active = activeKey(transaction.state, index);
    if (value.pending || index !== value.index || active !== value.active || composition) {
      const decorations = !value.pending && index === value.index && !transaction.docChanged && !composition
        ? updateSelectionDecorations(value.decorations, transaction, index)
        : buildDecorations(transaction.state, index);
      return { decorations, index, active, composing, pending: false };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export const livePreview = [previewState, ViewPlugin.fromClass(
  class {
    refreshTimer: number | null = null;
    constructor(view: EditorView) { this.schedule(view); }
    schedule(view: EditorView) {
      if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = null;
        if (view.composing) return;
        const complete = forceParsing(view, view.state.doc.length, 10);
        view.dispatch({ effects: refreshLivePreview.of(null) });
        if (!complete) this.schedule(view);
      }, previewRefreshDelay);
    }
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.startState) === syntaxTree(update.state)) return;
      this.schedule(update.view);
    }
    destroy() {
      if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    }
  },
), EditorView.domEventHandlers({
  compositionstart(_event, view) { view.dispatch({ effects: composingPreview.of(true) }); },
  compositionend(_event, view) {
    // Let CodeMirror ingest the final composition mutation before refreshing.
    requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: [composingPreview.of(false), refreshLivePreview.of(null)] }); });
  },
})];
