import { forceParsing, syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { MDX, mdxJsxLanguage } from "./mdx";

function nodeNames(source: string) {
  const view = new EditorView({
    state: EditorState.create({
      doc: source,
      extensions: [markdown({ extensions: [MDX], htmlTagLanguage: mdxJsxLanguage })],
    }),
  });
  forceParsing(view, view.state.doc.length, 1_000);
  const names: string[] = [];
  syntaxTree(view.state).iterate({ enter: (node) => { names.push(node.name); } });
  view.destroy();
  return names;
}

describe("MDX language support", () => {
  it("parses ESM declarations as JavaScript", () => {
    const names = nodeNames("import Callout from './Callout'\n\n# Title");

    expect(names).toContain("ImportDeclaration");
    expect(names).toContain("ATXHeading1");
  });

  it("parses inline expressions without consuming surrounding Markdown", () => {
    const names = nodeNames("Hello **{user.name}** and {items.map((item) => item.label)}.");

    expect(names).toContain("MemberExpression");
    expect(names).toContain("ArrowFunction");
    expect(names).toContain("StrongEmphasis");
  });

  it("keeps braces inside strings and comments within one expression", () => {
    const names = nodeNames("{condition ? `a } b` : /* } */ fallback}\n\nAfter");

    expect(names).toContain("ConditionalExpression");
    expect(names.filter((name) => name === "Paragraph")).toHaveLength(2);
  });

  it("parses component tags and JSX attribute expressions", () => {
    const source = "<Callout tone={theme.tone}>Hello</Callout>";
    const view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [markdown({ extensions: [MDX], htmlTagLanguage: mdxJsxLanguage })],
      }),
    });
    forceParsing(view, view.state.doc.length, 1_000);
    const names: string[] = [];
    const tree = syntaxTree(view.state);
    for (let node: SyntaxNode | null = tree.resolveInner(source.indexOf("theme"), 1); node; node = node.parent) {
      names.push(node.name);
    }
    view.destroy();

    expect(names).toContain("JSXAttribute");
    expect(names).toContain("MemberExpression");
  });
});
