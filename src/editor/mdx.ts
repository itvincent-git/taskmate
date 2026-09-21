import { tsxLanguage } from "@codemirror/lang-javascript";
import { LanguageSupport } from "@codemirror/language";
import { parseMixed } from "@lezer/common";
import type { BlockContext, InlineContext, LeafBlock, LeafBlockParser, MarkdownExtension } from "@lezer/markdown";

const expressionNode = "MDXExpression";
const esmNode = "MDXESM";

export const mdxJsxLanguage = new LanguageSupport(tsxLanguage);

class MdxEsmParser implements LeafBlockParser {
  nextLine() {
    return false;
  }

  finish(context: BlockContext, leaf: LeafBlock) {
    context.addLeafElement(leaf, context.elt(esmNode, leaf.start, leaf.start + leaf.content.length));
    return true;
  }
}

function mdxExpression(context: InlineContext, next: number, position: number) {
  if (next !== 123) return -1;
  const end = expressionEnd(context, position);
  return end === -1
    ? -1
    : context.addElement(context.elt(expressionNode, position, end));
}

function expressionEnd(context: InlineContext, position: number) {
  let depth = 1;
  let quote = 0;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let cursor = position + 1; cursor < context.end; cursor += 1) {
    const character = context.char(cursor);
    const following = context.char(cursor + 1);

    if (lineComment) {
      if (character === 10) lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === 42 && following === 47) {
        blockComment = false;
        cursor += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === 92) {
        escaped = true;
      } else if (character === quote) {
        quote = 0;
      }
      continue;
    }
    if (character === 39 || character === 34 || character === 96) {
      quote = character;
    } else if (character === 47 && following === 47) {
      lineComment = true;
      cursor += 1;
    } else if (character === 47 && following === 42) {
      blockComment = true;
      cursor += 1;
    } else if (character === 123) {
      depth += 1;
    } else if (character === 125 && --depth === 0) {
      return cursor + 1;
    }
  }
  return -1;
}

export const MDX: MarkdownExtension = {
  defineNodes: [
    { name: expressionNode },
    { name: esmNode, block: true },
  ],
  parseInline: [{ name: expressionNode, parse: mdxExpression, before: "Escape" }],
  parseBlock: [{
    name: esmNode,
    leaf(_context, leaf) {
      return /^\s*(?:import|export)\b/.test(leaf.content) ? new MdxEsmParser() : null;
    },
    before: "SetextHeading",
  }],
  wrap: parseMixed((node) => {
    if (node.name === expressionNode) {
      return {
        parser: tsxLanguage.parser,
        bracketed: true,
      };
    }
    return node.name === esmNode ? { parser: tsxLanguage.parser } : null;
  }),
};
