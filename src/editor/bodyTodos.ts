import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { MDX, mdxExpressionEnd } from "./mdx";

const todoParser = parser.configure([GFM, MDX]);

export interface BodyTodo {
  markerFrom: number;
  markerTo: number;
  to: number;
  text: string;
  details: string;
  headings: string[];
  parent: string;
  checked: boolean;
  cancelled: boolean;
  quoted: boolean;
}

function inlineText(body: string, node: SyntaxNode, from: number, to: number, omitStrikes = false) {
  const omitted: { from: number; to: number }[] = [];
  const visit = (child: SyntaxNode) => {
    if (child.to <= from || child.from >= to) return;
    if ((omitStrikes && child.name === "Strikethrough") || /^(EmphasisMark|StrikethroughMark|CodeMark|LinkMark|HeaderMark)$/.test(child.name)
      || (child.name === "URL" && ["Link", "Image"].includes(child.parent?.name ?? ""))) {
      omitted.push({ from: Math.max(from, child.from), to: Math.min(to, child.to) });
      return;
    }
    if (child.name === "Escape") omitted.push({ from: child.from, to: child.from + 1 });
    for (let next = child.firstChild; next; next = next.nextSibling) visit(next);
  };
  visit(node);
  let text = "";
  let position = from;
  for (const range of omitted) { text += body.slice(position, range.from); position = range.to; }
  return (text + body.slice(position, to)).replace(/\s+/g, " ").trim();
}

export function extractBodyTodos(body: string): BodyTodo[] {
  const tree = todoParser.parse(body);
  // Inline Markdown blocks can split a multiline MDX expression. Use the same
  // expression scanner to exclude its complete range, including template text.
  const expressions: { from: number; to: number }[] = [];
  tree.iterate({ enter(node) {
    if (node.name !== "Paragraph") return;
    const start = body.slice(node.from, node.to).search(/\S/);
    const from = node.from + start;
    if (start >= 0 && body[from] === "{") {
      const to = mdxExpressionEnd(body, from);
      if (to >= 0) expressions.push({ from, to });
    }
  } });
  const todos: BodyTodo[] = [];
  const headings: { level: number; text: string }[] = [];
  const parents = new Map<number, string>();
  tree.iterate({
    enter(node) {
      if (expressions.some((range) => node.from >= range.from && node.to <= range.to)) return false;
      if (["FencedCode", "CodeBlock", "HTMLBlock", "MDXExpression", "MDXESM"].includes(node.name)) return false;
      let quoted = false;
      for (let parent = node.node.parent; parent; parent = parent.parent) {
        if (parent.name === "Blockquote") quoted = true;
      }
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading && !quoted) {
        const level = Number(heading[1]);
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        headings.push({ level, text: inlineText(body, node.node, node.from, node.to) });
      }
      if (node.name !== "Task") return;
      const marker = node.node.getChild("TaskMarker");
      if (!marker) return;
      const lineEnd = body.indexOf("\n", marker.to);
      const labelEnd = lineEnd < 0 ? node.to : Math.min(lineEnd, node.to);
      const text = inlineText(body, node.node, marker.to, labelEnd);
      if (!text) return;
      const strikes: SyntaxNode[] = [];
      const findStrikes = (child: SyntaxNode) => {
        if (child.name === "Strikethrough") { strikes.push(child); return; }
        for (let next = child.firstChild; next; next = next.nextSibling) findStrikes(next);
      };
      findStrikes(node.node);
      const listItem = node.node.parent;
      let parentText = "";
      for (let parent = listItem?.parent; parent; parent = parent.parent) {
        if (parents.has(parent.from) && parent.name === "ListItem") { parentText = parents.get(parent.from)!; break; }
      }
      if (listItem) parents.set(listItem.from, text);
      todos.push({
        markerFrom: marker.from, markerTo: marker.to, to: node.to,
        text, details: body.slice(labelEnd, listItem?.to ?? node.to).trim(),
        headings: headings.map((item) => item.text), parent: parentText,
        checked: /^\[[xX]\]$/.test(body.slice(marker.from, marker.to)),
        cancelled: strikes.length > 0 && !inlineText(body, node.node, marker.to, node.to, true), quoted,
      });
    },
  });
  return todos;
}

// Positions belong to a document version. Relocate only when the context is unique
// in both versions; identical labels must never cause a different item to be edited.
export function resolveBodyTodo(body: string, source: string, item: BodyTodo): BodyTodo | null {
  const todos = extractBodyTodos(body);
  if (body === source) return todos.find((candidate) => candidate.markerFrom === item.markerFrom) ?? null;
  const matches = (candidate: BodyTodo) => candidate.text === item.text
    && candidate.parent === item.parent && candidate.quoted === item.quoted
    && candidate.cancelled === item.cancelled && JSON.stringify(candidate.headings) === JSON.stringify(item.headings);
  const candidates = todos.filter(matches);
  if (candidates.length !== 1 || extractBodyTodos(source).filter(matches).length !== 1) return null;
  return candidates[0];
}

