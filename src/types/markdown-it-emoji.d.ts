declare module "markdown-it-emoji" {
  import MarkdownIt from "markdown-it";

  export const full: (markdown: ReturnType<typeof MarkdownIt>) => void;
}
