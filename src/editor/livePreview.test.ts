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

  it("hides heading markers and separator whitespace for h1 through h6", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const headings = Array.from({ length: 6 }, (_, index) => `${"#".repeat(index + 1)} Heading ${index + 1}`);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: ["plain", ...headings].join("\n"),
        extensions: [markdown(), livePreview],
      }),
    });

    expect(Array.from(host.querySelectorAll(".cm-line"), (line) => line.textContent)).toEqual([
      "plain",
      ...headings.map((_, index) => `Heading ${index + 1}`),
    ]);

    view.destroy();
    host.remove();
  });

  it("hides all heading separator whitespace and restores it when active", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n### \t  Heading",
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelectorAll(".cm-line")[1]?.textContent).toBe("Heading");
    view.dispatch({ selection: { anchor: 10 } });
    expect(host.querySelectorAll(".cm-line")[1]?.textContent).toBe("### \t  Heading");
    expect(view.state.doc.toString()).toBe("plain\n### \t  Heading");

    view.destroy();
    host.remove();
  });
});
