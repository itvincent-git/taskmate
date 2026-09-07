import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";

export const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "ecmascript", "node"],
    extensions: ["js", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript()),
  }),
  LanguageDescription.of({
    name: "JSX",
    extensions: ["jsx"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts", "mts", "cts"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "TSX",
    extensions: ["tsx"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    load: () => import("@codemirror/lang-java").then(({ java }) => java()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs"],
    extensions: ["rs"],
    load: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    extensions: ["py", "pyw"],
    load: () => import("@codemirror/lang-python").then(({ python }) => python()),
  }),
  LanguageDescription.of({
    name: "Objective-C",
    alias: ["objective-c", "objc"],
    extensions: ["m"],
    load: () => import("@codemirror/legacy-modes/mode/clike").then(({ objectiveC }) => (
      new LanguageSupport(StreamLanguage.define(objectiveC))
    )),
  }),
  LanguageDescription.of({
    name: "Swift",
    extensions: ["swift"],
    load: () => import("@codemirror/legacy-modes/mode/swift").then(({ swift }) => (
      new LanguageSupport(StreamLanguage.define(swift))
    )),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh"],
    extensions: ["sh", "bash", "zsh"],
    load: () => import("@codemirror/legacy-modes/mode/shell").then(({ shell }) => (
      new LanguageSupport(StreamLanguage.define(shell))
    )),
  }),
  LanguageDescription.of({
    name: "JSON",
    extensions: ["json", "jsonc"],
    load: () => import("@codemirror/legacy-modes/mode/javascript").then(({ json }) => (
      new LanguageSupport(StreamLanguage.define(json))
    )),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load: () => import("@codemirror/legacy-modes/mode/yaml").then(({ yaml }) => (
      new LanguageSupport(StreamLanguage.define(yaml))
    )),
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load: () => import("@codemirror/legacy-modes/mode/toml").then(({ toml }) => (
      new LanguageSupport(StreamLanguage.define(toml))
    )),
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load: () => import("@codemirror/legacy-modes/mode/sql").then(({ standardSQL }) => (
      new LanguageSupport(StreamLanguage.define(standardSQL))
    )),
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load: () => import("@codemirror/legacy-modes/mode/css").then(({ css }) => (
      new LanguageSupport(StreamLanguage.define(css))
    )),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["htm"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/legacy-modes/mode/xml").then(({ html }) => (
      new LanguageSupport(StreamLanguage.define(html))
    )),
  }),
  LanguageDescription.of({
    name: "Diff",
    alias: ["patch"],
    extensions: ["diff", "patch"],
    load: () => import("@codemirror/legacy-modes/mode/diff").then(({ diff }) => (
      new LanguageSupport(StreamLanguage.define(diff))
    )),
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: ["md"],
    extensions: ["md", "markdown"],
    load: () => import("@codemirror/lang-markdown").then(({ markdown }) => markdown()),
  }),
];
