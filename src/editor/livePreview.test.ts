import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
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

  it("renders checked and unchecked task markers distinctly", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n- [ ] todo\n- [x] done",
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    expect(Array.from(host.querySelectorAll(".cm-lp-marker-task"), (marker) => marker.textContent)).toEqual(["☐", "☑"]);

    view.destroy();
    host.remove();
  });

  it("renders horizontal rules when they are not active", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n\n---",
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelector(".cm-lp-rule")).not.toBeNull();
    expect(host.textContent).not.toContain("---");

    view.destroy();
    host.remove();
  });

  it("hides fenced code language info until the block is active", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n\n```ts\nconst value = 1;\n```",
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.textContent).not.toContain("ts");
    expect(host.textContent).toContain("const value = 1;");
    view.dispatch({ selection: { anchor: 12 } });
    expect(host.textContent).toContain("```ts");

    view.destroy();
    host.remove();
  });

  it("renders inactive GFM tables and restores their source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n| Item | State |\n| --- | :---: |\n| Edit | Done |";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    const tableRows = host.querySelectorAll(".cm-lp-table-row");
    expect(tableRows).toHaveLength(2);
    expect(tableRows[0]?.querySelectorAll('[role="columnheader"]')).toHaveLength(2);
    expect(tableRows[1]?.querySelectorAll('[role="cell"]')).toHaveLength(2);
    expect(tableRows[0]?.textContent).toContain("Item");
    expect(host.textContent).not.toContain("| --- |");

    view.dispatch({ selection: { anchor: source.indexOf("Item") } });
    expect(host.querySelector(".cm-lp-table-row")).toBeNull();
    expect(host.textContent).toContain("| Item | State |");

    view.destroy();
    host.remove();
  });
});
