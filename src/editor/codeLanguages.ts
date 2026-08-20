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
];
