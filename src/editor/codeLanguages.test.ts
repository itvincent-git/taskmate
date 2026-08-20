import { LanguageDescription } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { codeLanguages } from "./codeLanguages";

describe("codeLanguages", () => {
  it.each(["js", "ts", "java", "rust", "objc", "swift", "python", "jsx", "tsx"])(
    "loads the %s fenced-code language",
    async (name) => {
      const description = LanguageDescription.matchLanguageName(codeLanguages, name, false);

      expect(description).not.toBeNull();
      await expect(description?.load()).resolves.toBeDefined();
    },
  );
});
