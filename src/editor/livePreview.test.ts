import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { linkUrlAt, livePreview, rangeIsActive } from "./livePreview";

describe("Live Preview activation", () => {
  it("reveals syntax when the cursor or selection intersects its node", () => {
    expect(rangeIsActive(4, 12, [{ from: 8, to: 8 }])).toBe(true);
    expect(rangeIsActive(4, 12, [{ from: 0, to: 5 }])).toBe(true);
    expect(rangeIsActive(4, 12, [{ from: 13, to: 15 }])).toBe(false);
  });

  it("only reveals the selected syntax node during IME composition", () => {
    expect(rangeIsActive(4, 12, [{ from: 8, to: 8 }], true)).toBe(true);
    expect(rangeIsActive(4, 12, [{ from: 30, to: 30 }], true)).toBe(false);
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

  it("renders safe inline HTML and reveals its source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = 'plain\nBefore <mark>important</mark> and <a href="https://example.com">linked</a>.';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelector("mark")).toHaveTextContent("important");
    expect(host.querySelector('a[data-link-url="https://example.com"]')).toHaveTextContent("linked");
    expect(host.textContent).not.toContain("<mark>");

    view.dispatch({ selection: { anchor: source.indexOf("important") } });
    expect(host.querySelector("mark")).toBeNull();
    expect(host.textContent).toContain("<mark>important</mark>");

    view.destroy();
    host.remove();
  });

  it("renders block HTML without executing unsafe content", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = 'plain\n\n<details open onclick="alert(1)">\n<summary>More</summary>\n<script>unsafe()</script><strong>Safe</strong>\n</details>';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), livePreview],
      }),
    });

    const preview = host.querySelector('[data-preview-kind="html"]');
    expect(preview?.querySelector("details")).toHaveAttribute("open");
    expect(preview?.querySelector("summary")).toHaveTextContent("More");
    expect(preview?.querySelector("strong")).toHaveTextContent("Safe");
    expect(preview?.querySelector("script")).toBeNull();
    expect(preview?.querySelector("details")).not.toHaveAttribute("onclick");
    expect(preview).not.toHaveTextContent("unsafe()");

    view.destroy();
    host.remove();
  });

  it("keeps bare URLs visible while hiding formatted link targets", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const bareUrl = "https://example.com/live?id=123";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: `plain\n${bareUrl}\n[Example](https://example.com/hidden)`,
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    expect(host.textContent).toContain(bareUrl);
    expect(host.querySelector(".text-accent")).toHaveTextContent(bareUrl);
    expect(host.textContent).toContain("Example");
    expect(host.textContent).not.toContain("https://example.com/hidden");
    expect(host.querySelector('[data-link-url="https://example.com/live?id=123"]')).not.toBeNull();
    expect(host.querySelector('[data-link-url="https://example.com/hidden"]')).not.toBeNull();

    view.destroy();
    host.remove();
  });

  it("resolves formatted, autolink, and bare URL destinations", () => {
    const doc = "[Example](https://example.com) <https://tauri.app> https://openai.com plain";
    const state = EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] });

    expect(linkUrlAt(state, doc.indexOf("Example"))).toBe("https://example.com");
    expect(linkUrlAt(state, doc.indexOf("tauri"))).toBe("https://tauri.app");
    expect(linkUrlAt(state, doc.indexOf("openai"))).toBe("https://openai.com");
    expect(linkUrlAt(state, doc.indexOf("plain"))).toBeNull();
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

  it("renders clickable task checkboxes and updates their Markdown markers", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n- [ ] todo\n- [x] done",
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    const checkboxes = host.querySelectorAll<HTMLButtonElement>('[data-marker-kind="task"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toHaveAttribute("role", "checkbox");
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "false");
    expect(checkboxes[0]?.querySelector("svg")).toBeNull();
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]?.querySelector("svg")).toHaveClass("lucide", "lucide-check");
    expect(host.querySelector('[data-marker-kind="bullet"]')).toBeNull();

    checkboxes[0]?.click();

    expect(view.state.doc.toString()).toBe("plain\n- [x] todo\n- [x] done");
    expect(host.querySelectorAll('[data-marker-kind="task"][aria-checked="true"]')).toHaveLength(2);

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

    expect(host.querySelector('[data-preview-kind="rule"]')).not.toBeNull();
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

    const tableRows = host.querySelectorAll('[data-preview-kind="table-row"]');
    expect(tableRows).toHaveLength(2);
    expect(tableRows[0]?.querySelectorAll('[role="columnheader"]')).toHaveLength(2);
    expect(tableRows[1]?.querySelectorAll('[role="cell"]')).toHaveLength(2);
    expect(tableRows[0]?.textContent).toContain("Item");
    expect(host.textContent).not.toContain("| --- |");

    view.dispatch({ selection: { anchor: source.indexOf("Item") } });
    expect(host.querySelector('[data-preview-kind="table-row"]')).toBeNull();
    expect(host.textContent).toContain("| Item | State |");

    view.destroy();
    host.remove();
  });
});
