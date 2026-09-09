import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { documentHeadings, linkUrlAt, livePreview, rangeIsActive } from "./livePreview";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => ({
      svg: `<svg aria-label="diagram"><text>${source}</text></svg>`,
    })),
  },
}));

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

  it("renders backslash-escaped Markdown punctuation as literal characters", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\\*literal\\* \\# heading \\[label\\] \\`code\\` \\$math$";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    expect(host.querySelectorAll(".cm-line")[1]).toHaveTextContent("*literal* # heading [label] `code` $math$");
    expect(host.querySelector(".font-\\[750\\], .italic, .text-accent, [data-preview-kind='math']")).toBeNull();

    view.dispatch({ selection: { anchor: source.indexOf("\\*") + 1 } });
    expect(host.querySelectorAll(".cm-line")[1]).toHaveTextContent("\\*literal* # heading [label] `code` $math$");

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

  it("renders HTML images and removes unsafe image attributes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = 'plain\n<img src="attachments/example.png" alt="Example" title="Preview" onerror="alert(1)">';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), livePreview],
      }),
    });

    const image = host.querySelector<HTMLImageElement>('[data-preview-kind="html"] img');
    expect(image).toHaveAttribute("alt", "Example");
    expect(image).toHaveAttribute("title", "Preview");
    expect(image).not.toHaveAttribute("onerror");
    await vi.waitFor(() => expect(image).toHaveAttribute("src", "attachments/example.png"));
    expect(host.textContent).not.toContain("<img");

    view.dispatch({ selection: { anchor: source.indexOf("example.png") } });
    expect(host.querySelector('[data-preview-kind="html"] img')).toBeNull();
    expect(host.textContent).toContain("<img");

    view.destroy();
    host.remove();
  });

  it("renders multiline HTML images without hiding the following document", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain",
      "<img",
      'src="https://picsum.photos/300/180"',
      'alt="HTML image"',
      'width="300"',
      "/>",
      "## Following heading",
      "Following content",
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), livePreview],
      }),
    });

    await vi.waitFor(() => expect(host.querySelector('[data-preview-kind="html"] img')).toHaveAttribute("src"));
    expect(host.textContent).toContain("Following heading");
    expect(host.textContent).toContain("Following content");

    view.destroy();
    host.remove();
  });

  it("does not load unsafe HTML image sources", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: 'plain\n<img src="javascript:alert(1)" alt="Unsafe">',
        extensions: [markdown(), livePreview],
      }),
    });

    await Promise.resolve();
    expect(host.querySelector("img")).not.toHaveAttribute("src");

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

  it("renders Markdown inside HTML containers and restores the complete source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain",
      "",
      "<details>",
      "<summary>More</summary>",
      "",
      "Inside **bold**.",
      "",
      "- one",
      "- two",
      "",
      "</details>",
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    const preview = host.querySelector('[data-preview-kind="html-container"]');
    expect(preview?.querySelector("details > summary")).toHaveTextContent("More");
    expect(preview?.querySelector("details strong")).toHaveTextContent("bold");
    expect(preview?.querySelectorAll("details li")).toHaveLength(2);
    expect(host.textContent).not.toContain("<details>");

    view.dispatch({ selection: { anchor: source.indexOf("bold") } });
    expect(host.querySelector('[data-preview-kind="html-container"]')).toBeNull();
    expect(host.textContent).toContain("<details>");
    expect(host.textContent).toContain("Inside **bold**.");

    view.destroy();
    host.remove();
  });

  it("preserves safe alignment, direction, and image width attributes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain",
      "",
      '<div align="center" dir="rtl">',
      "",
      "Centered RTL content.",
      "",
      "</div>",
      "",
      '<img src="attachments/example.png" alt="Example" width="300">',
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    const container = host.querySelector('[data-preview-kind="html-container"] div');
    expect(container).toHaveAttribute("align", "center");
    expect(container).toHaveAttribute("dir", "rtl");
    const image = host.querySelector<HTMLImageElement>('[data-preview-kind="html"] img');
    expect(image).toHaveAttribute("width", "300");
    await vi.waitFor(() => expect(image).toHaveAttribute("src", "attachments/example.png"));

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

  it("renders full, collapsed, and shortcut reference links", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain",
      "Read [the guide][docs], [docs][], and [docs].",
      "",
      "[DOCS]: <https://example.com/guide>",
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    const links = host.querySelectorAll('[data-link-url="https://example.com/guide"]');
    expect(links).toHaveLength(3);
    expect(Array.from(links, (link) => link.textContent)).toEqual(["the guide", "docs", "docs"]);
    expect(host.querySelectorAll(".cm-line")[1]).toHaveTextContent("Read the guide, docs, and docs.");

    view.destroy();
    host.remove();
  });

  it("renders full, collapsed, and shortcut reference images and restores their source while editing", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain",
      "",
      "![Reference image][test-image] ![test-image][] ![test-image]",
      "",
      '[TEST-IMAGE]: <attachments/example.png> "Example image"',
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    await vi.waitFor(() => {
      const images = host.querySelectorAll('[data-preview-kind="image"]');
      expect(images).toHaveLength(3);
      images.forEach((image) => expect(image).toHaveAttribute("src", "attachments/example.png"));
    });
    expect(host.querySelectorAll('[data-preview-kind="image"]')[0]).toHaveAttribute("alt", "Reference image");
    expect(host.querySelectorAll('[data-preview-kind="image"]')[0]).toHaveAttribute("title", "Example image");
    view.dispatch({ selection: { anchor: source.indexOf("Reference image") } });
    expect(host.textContent).toContain("![Reference image][test-image]");
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    host.remove();
  });

  it("keeps unresolved image references as text and resolves inline image destinations from syntax", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = 'plain\n\n![missing][unknown]\n\n![inline](<attachments/a(b).png> "Image title")';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    expect(host.textContent).toContain("![missing][unknown]");
    expect(host.querySelectorAll('[data-preview-kind="image"]')).toHaveLength(1);
    await vi.waitFor(() => expect(host.querySelector('[data-preview-kind="image"]'))
      .toHaveAttribute("src", "attachments/a(b).png"));

    view.destroy();
    host.remove();
  });

  it("preserves Markdown image alt text and title separately from its source", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = 'plain\n\n![Example **diagram**](attachments/example.png "Image preview")';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    const image = host.querySelector<HTMLImageElement>('[data-preview-kind="image"]');
    expect(image).toHaveAttribute("alt", "Example diagram");
    expect(image).toHaveAttribute("title", "Image preview");
    await vi.waitFor(() => expect(image).toHaveAttribute("src", "attachments/example.png"));

    view.destroy();
    host.remove();
  });

  it("preserves formatted link titles as hover text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: 'plain\n[Example](https://example.com "Link hint")',
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelector('[data-link-url="https://example.com"]')).toHaveAttribute("title", "Link hint");

    view.destroy();
    host.remove();
  });

  it("collapses soft line breaks but renders Markdown hard breaks", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\nSoft first\nsoft second  \nhard next";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    const paragraph = host.querySelector('[data-preview-kind="paragraph"]');
    expect(paragraph).toHaveTextContent("Soft first soft second hard next");
    expect(paragraph?.querySelectorAll("br")).toHaveLength(1);
    expect(host.textContent).not.toContain("soft second  ");

    view.dispatch({ selection: { anchor: source.indexOf("soft second") } });
    expect(host.querySelector('[data-preview-kind="paragraph"]')).toBeNull();
    expect(host.textContent).toContain("soft second  ");

    view.destroy();
    host.remove();
  });

  it("hides inactive multiline reference definitions and reveals them while editing", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain", "", "[Guide][docs]", "", "![Picture][picture]", "",
      "[docs]:", "  <https://example.com>", '  "Documentation"', "",
      "[picture]: attachments/example.png", "", "Following paragraph",
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    expect(host.textContent).not.toContain("[docs]:");
    expect(host.textContent).not.toContain("Documentation");
    expect(host.textContent).not.toContain("[picture]:");
    expect(host.textContent).toContain("Following paragraph");
    expect(host.querySelector('[data-link-url="https://example.com"]')).toHaveTextContent("Guide");
    await vi.waitFor(() => expect(host.querySelector('[data-preview-kind="image"]'))
      .toHaveAttribute("src", "attachments/example.png"));
    expect(host.querySelectorAll('.cm-line[data-preview-hidden="reference"]')).toHaveLength(4);

    view.dispatch({ selection: { anchor: source.indexOf("Documentation") } });
    expect(host.textContent).toContain("[docs]:");
    expect(host.textContent).toContain("Documentation");
    expect(host.textContent).not.toContain("[picture]:");
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    host.remove();
  });

  it("keeps reference definition examples visible inside code", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n`[inline]: https://example.com`\n\n```md\n[fenced]: https://example.com\n```";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    expect(host.textContent).toContain("[inline]: https://example.com");
    expect(host.textContent).toContain("[fenced]: https://example.com");
    expect(host.querySelector('[data-preview-hidden="reference"]')).toBeNull();

    view.destroy();
    host.remove();
  });

  it("hides block comments across blank lines and restores them while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n<!--\nsecret\n\nmore secret\n-->\n\nafter";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    expect(host.textContent).not.toContain("secret");
    expect(host.textContent).not.toContain("<!--");
    expect(host.textContent).toContain("after");
    expect(host.querySelectorAll('[data-preview-hidden="comment"]')).toHaveLength(5);
    view.dispatch({ selection: { anchor: source.indexOf("secret") } });
    expect(host.textContent).toContain("<!--");
    expect(host.textContent).toContain("secret");
    expect(host.querySelector('[data-preview-hidden="comment"]')).toBeNull();
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    host.remove();
  });

  it("hides inline comments without hiding adjacent text or comments inside code", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\nbefore <!-- secret --> after\n\nleft <!--\nmultiline secret\n--> right\n\n`<!-- inline code -->`\n\n```html\n<!-- fenced code -->\n```";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    expect(host.textContent).not.toContain("secret");
    expect(host.textContent).toContain("before  after");
    expect(host.textContent).toContain("left ");
    expect(host.textContent).toContain(" right");
    expect(host.textContent).toContain("<!-- inline code -->");
    expect(host.textContent).toContain("<!-- fenced code -->");
    view.dispatch({ selection: { anchor: source.indexOf("secret") } });
    expect(host.textContent).toContain("before <!-- secret --> after");

    view.destroy();
    host.remove();
  });

  it("resolves reference link destinations at the linked text", () => {
    const doc = "[Reference][guide]\n\n[GUIDE]: https://example.com/reference";
    const state = EditorState.create({ doc, extensions: [markdown()] });

    expect(linkUrlAt(state, doc.indexOf("Reference"))).toBe("https://example.com/reference");
    expect(linkUrlAt(state, doc.indexOf("GUIDE"))).toBeNull();
  });

  it("indexes Unicode and duplicate headings and renders Setext headings", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n## 15. 代码块\n\n## 15. 代码块\n\nAnother **title**\n===\n\nSubtitle\n---";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });
    expect(documentHeadings(view.state).map(({ id, level }) => [id, level])).toEqual([
      ["15-代码块", 2], ["15-代码块-1", 2], ["another-title", 1], ["subtitle", 2],
    ]);
    expect(host.querySelector('[data-heading-id="another-title"]')).toHaveTextContent("Another title");
    expect(host.textContent).not.toContain("===");
    expect(host.textContent).not.toContain("---");
    view.dispatch({ selection: { anchor: source.indexOf("Another") } });
    expect(host.textContent).toContain("===");
    view.destroy();
    host.remove();
  });

  it("renders a hierarchical TOC that navigates and updates with headings", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n[TOC]\n\n# Main\n\n## Child\n\n## Child";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });
    const toc = host.querySelector('[data-preview-kind="toc"]');
    expect(toc).toHaveAttribute("aria-label", "Table of contents");
    expect(Array.from(toc!.querySelectorAll("li"), (item) => item.dataset.headingLevel)).toEqual(["1", "2", "2"]);
    expect(toc!.querySelectorAll("li")[1]).toHaveStyle({ marginInlineStart: "16px" });
    toc!.querySelector<HTMLButtonElement>('[data-toc-target="child-1"]')!.click();
    expect(view.state.selection.main.head).toBe(source.lastIndexOf("## Child"));

    view.dispatch({ changes: { from: source.indexOf("Main"), to: source.indexOf("Main") + 4, insert: "Renamed" } });
    view.dispatch({ selection: { anchor: source.indexOf("Child") } });
    expect(host.querySelector('[data-toc-target="renamed"]')).toHaveTextContent("Renamed");
    view.dispatch({ selection: { anchor: source.indexOf("[TOC]") + 1 } });
    expect(host.querySelector('[data-preview-kind="toc"]')).toBeNull();
    expect(host.textContent).toContain("[TOC]");
    view.destroy();
    host.remove();
  });

  it("removes hidden multiline source lines from layout", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "first soft line\nsecond soft line\nthird soft line\n\n";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    view.dispatch({ selection: { anchor: source.length } });

    const hiddenLines = host.querySelectorAll<HTMLElement>(".cm-line.hidden");
    expect(hiddenLines.length).toBeGreaterThan(0);
    hiddenLines.forEach((line) => expect(line).toHaveStyle({ display: "none" }));
    expect(host.querySelector('[data-preview-kind="paragraph"]')).not.toBeNull();
    view.destroy();
    host.remove();
  });

  it("only renders standalone TOC directives outside code and includes distant headings", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n[TOC]\n\n`[TOC]`\n\n```md\n[TOC]\n```\n\nAn inline [TOC] marker\n\n"
      + "paragraph\n\n".repeat(500) + "# Distant";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });
    expect(host.querySelectorAll('[data-preview-kind="toc"]')).toHaveLength(1);
    expect(host.querySelector('[data-toc-target="distant"]')).toHaveTextContent("Distant");
    expect(host.textContent).toContain("[TOC]");
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

  it("renders inline and block math and restores the source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain with $x^2$\n\n$$\n\\frac{a}{b}\n$$";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelectorAll('[data-preview-kind="math"]')).toHaveLength(2);
    expect(host.querySelectorAll(".katex")).toHaveLength(2);
    expect(host.textContent).not.toContain("$x^2$");

    view.dispatch({ selection: { anchor: source.indexOf("x^2") } });
    expect(host.textContent).toContain("$x^2$");
    expect(host.querySelectorAll('[data-preview-kind="math"]')).toHaveLength(1);

    view.destroy();
    host.remove();
  });

  it("renders Mermaid fences and restores their source while editing", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n```mermaid\ngraph TD\n  A --> B\n```";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), livePreview],
      }),
    });

    await vi.waitFor(() => expect(host.querySelector('[data-preview-kind="mermaid"] svg')).not.toBeNull());
    expect(host.textContent).toContain("graph TD");
    expect(host.textContent).not.toContain("```mermaid");

    view.dispatch({ selection: { anchor: source.indexOf("graph TD") } });
    expect(host.querySelector('[data-preview-kind="mermaid"]')).toBeNull();
    expect(host.textContent).toContain("```mermaid");

    view.destroy();
    host.remove();
  });

  it("keeps unfinished Mermaid fences editable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n\n```mermaid\ngraph TD\n  A --> B",
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelector('[data-preview-kind="mermaid"]')).toBeNull();
    expect(host.textContent).toContain("graph TD");

    view.destroy();
    host.remove();
  });

  it("does not render math syntax inside code", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain `price $5$`\n\n```txt\n$x$\n```",
        extensions: [markdown(), livePreview],
      }),
    });

    expect(host.querySelector('[data-preview-kind="math"]')).toBeNull();

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
    expect(getComputedStyle(host.querySelector<HTMLElement>(".cm-line.hidden")!).display).toBe("none");

    view.dispatch({ selection: { anchor: source.indexOf("Item") } });
    expect(host.querySelector('[data-preview-kind="table-row"]')).toBeNull();
    expect(host.textContent).toContain("| Item | State |");

    view.destroy();
    host.remove();
  });

  it("preserves empty GFM table cells", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "plain\n\n| A | | C |\n| --- | --- | --- |\n| X | | Z |",
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    const rows = host.querySelectorAll('[data-preview-kind="table-row"]');
    expect(rows[0]?.querySelectorAll('[role="columnheader"]')).toHaveLength(3);
    expect(rows[1]?.querySelectorAll('[role="cell"]')).toHaveLength(3);
    expect(rows[1]?.querySelectorAll('[role="cell"]')[1]).toBeEmptyDOMElement();

    view.destroy();
    host.remove();
  });

  it("renders escaped pipes and inline Markdown inside GFM table cells", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n| Value | Notes |\n| --- | --- |\n| A \\| B | **bold** and [link](https://example.com) |";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [markdown({ extensions: [GFM] }), livePreview],
      }),
    });

    const cells = host.querySelectorAll('[data-preview-kind="table-row"] [role="cell"]');
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveTextContent("A | B");
    expect(cells[0]).not.toHaveTextContent("\\|");
    expect(cells[1]?.querySelector(".font-\\[750\\]")).toHaveTextContent("bold");
    expect(cells[1]?.querySelector('[data-link-url="https://example.com"]')).toHaveTextContent("link");
    expect(cells[1]).not.toHaveTextContent("**");
    expect(cells[1]).not.toHaveTextContent("https://example.com");

    view.destroy();
    host.remove();
  });

  it("renders footnote references and definitions and reveals their source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = [
      "plain",
      "Text with a footnote.[^note] Another reference.[^note]",
      "",
      "[^note]: Footnote with **formatting**.",
      "",
      "    A second paragraph.",
    ].join("\n");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown({ extensions: [GFM] }), livePreview] }),
    });

    expect(host.querySelectorAll('[data-preview-kind="footnote-reference"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-footnote-label="note"]')[0]).toHaveTextContent("1");
    expect(host.querySelector('[data-preview-kind="footnote-definition"]')).toHaveTextContent(
      "Footnote with formatting. A second paragraph.",
    );
    expect(host.querySelector('[data-preview-kind="footnote-definition"] strong')).toHaveTextContent("formatting");
    expect(host.textContent).not.toContain("[^note]");

    view.dispatch({ selection: { anchor: source.indexOf("[^note]") + 2 } });
    expect(host.querySelectorAll('[data-preview-kind="footnote-reference"]')).toHaveLength(1);
    expect(host.textContent).toContain("[^note]");

    view.destroy();
    host.remove();
  });

  it("renders GitHub admonitions and restores the blockquote source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\n> [!NOTE]\n> Read **this** note.\n\n> [!WARNING]\n> Be careful.";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown({ extensions: [GFM] }), livePreview] }),
    });

    const admonitions = host.querySelectorAll('[data-preview-kind="admonition"]');
    expect(admonitions).toHaveLength(2);
    expect(admonitions[0]).toHaveAttribute("data-admonition-type", "note");
    expect(admonitions[0]).toHaveTextContent("NoteRead this note.");
    expect(admonitions[0]?.querySelector("strong")).toHaveTextContent("this");
    expect(admonitions[1]).toHaveAttribute("data-admonition-type", "warning");
    expect(host.textContent).not.toContain("[!NOTE]");

    view.dispatch({ selection: { anchor: source.indexOf("[!NOTE]") + 2 } });
    expect(host.querySelectorAll('[data-preview-kind="admonition"]')).toHaveLength(1);
    expect(host.textContent).toContain("[!NOTE]");

    view.destroy();
    host.remove();
  });

  it("renders definition lists and restores their source while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n\nMarkdown\n: A **lightweight** markup language.\n\nTauri\n: A desktop framework.";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown({ extensions: [GFM] }), livePreview] }),
    });

    const lists = host.querySelectorAll('[data-preview-kind="definition-list"]');
    expect(lists).toHaveLength(2);
    expect(lists[0]?.querySelector("dt")).toHaveTextContent("Markdown");
    expect(lists[0]?.querySelector("dd")).toHaveTextContent("A lightweight markup language.");
    expect(lists[0]?.querySelector("strong")).toHaveTextContent("lightweight");
    expect(host.textContent).not.toContain(": A **lightweight**");

    view.dispatch({ selection: { anchor: source.indexOf("lightweight") } });
    expect(host.querySelectorAll('[data-preview-kind="definition-list"]')).toHaveLength(1);
    expect(host.textContent).toContain(": A **lightweight** markup language.");

    view.destroy();
    host.remove();
  });

  it("renders supported emoji shortcodes outside code and restores them while editing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = "plain\n:smile: :rocket: :white_check_mark: :warning: :fire: :not_an_emoji: `:smile:` \\:rocket:";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: source, extensions: [markdown(), livePreview] }),
    });

    expect(Array.from(host.querySelectorAll('[data-preview-kind="emoji"]'), (node) => node.textContent)).toEqual([
      "😄", "🚀", "✅", "⚠️", "🔥",
    ]);
    expect(host.textContent).toContain(":not_an_emoji:");
    expect(host.textContent).toContain(":smile:");
    expect(host.textContent).toContain(":rocket:");

    view.dispatch({ selection: { anchor: source.indexOf(":smile:") + 2 } });
    expect(host.querySelectorAll('[data-preview-kind="emoji"]')).toHaveLength(4);
    expect(host.textContent).toContain(":smile:");

    view.destroy();
    host.remove();
  });
});
