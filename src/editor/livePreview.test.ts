import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { livePreview, rangeIsActive } from "./livePreview";

describe("Live Preview activation", () => {
  it("reveals syntax when the cursor or selection intersects its node", () => {
    expect(rangeIsActive(4, 12, [{ from: 8, to: 8 }])).toBe(true);
    expect(rangeIsActive(4, 12, [{ from: 0, to: 5 }])).toBe(true);
    expect(rangeIsActive(4, 12, [{ from: 13, to: 15 }])).toBe(false);
  });

  it("keeps all markers visible during IME composition", () => {
    expect(rangeIsActive(4, 12, [{ from: 30, to: 30 }], true)).toBe(true);
  });

  it("hides inactive markers and reveals them when the cursor enters the syntax node", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n**bold**",
        extensions: [markdown(), livePreview],
      }),
    });
    expect(host.textContent).toContain("bold");
    expect(host.textContent).not.toContain("**");
    view.dispatch({ selection: { anchor: 10 } });
    expect(host.textContent).toContain("**bold**");
    expect(view.state.doc.toString()).toBe("plain\n**bold**");
    view.destroy();
    host.remove();
  });
});
