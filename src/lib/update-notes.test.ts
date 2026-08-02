import { describe, expect, it } from "vitest";
import { localizeUpdateNotes } from "./update-notes";

describe("localizeUpdateNotes", () => {
  it("keeps plain release notes unchanged", () => {
    expect(localizeUpdateNotes("- Added update details", "en")).toBe("- Added update details");
  });

  it("selects localized notes from the changelog fallback", () => {
    const notes = JSON.stringify({ en: "- English details", zh: "- 中文更新内容" });
    expect(localizeUpdateNotes(notes, "zh-CN")).toBe("- 中文更新内容");
    expect(localizeUpdateNotes(notes, "en")).toBe("- English details");
  });
});
