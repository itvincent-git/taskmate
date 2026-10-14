import { describe, expect, it } from "vitest";
import { extractBodyTodos, resolveBodyTodo } from "./bodyTodos";

describe("body todos", () => {
  it("retains heading paths, parent context, multiline details and exact marker positions", () => {
    const body = "# Sites\n## camel2.to\n- [ ] Login gate\n  Show a hint first.\n  - [ ] Test on mobile\n\n## Other\n1. [X] Shipped\n";
    const [parent, child, shipped] = extractBodyTodos(body);
    expect(parent).toMatchObject({ text: "Login gate", headings: ["Sites", "camel2.to"], checked: false });
    expect(parent.details).toContain("Show a hint first.");
    expect(child).toMatchObject({ text: "Test on mobile", parent: "Login gate", headings: ["Sites", "camel2.to"] });
    expect(body.slice(child.markerFrom, child.markerTo)).toBe("[ ]");
    expect(shipped).toMatchObject({ text: "Shipped", checked: true, headings: ["Sites", "Other"] });
  });

  it("ignores fenced and indented code, HTML, MDX expressions and empty items", () => {
    const body = "```md\n- [ ] Example\n```\n\n    - [ ] Indented code\n\n<Component>\n- [ ] JSX example\n</Component>\n\n{`\n- [ ] Expression example\n`}\n\n- [ ] \n- [ ] Real\n";
    expect(extractBodyTodos(body).map((item) => item.text)).toEqual(["Real"]);
  });

  it("distinguishes full cancellation from partially struck text and preserves code identifiers", () => {
    const items = extractBodyTodos("- [ ] ~~Cancelled~~\n- [ ] ~~Old~~ New\n- [ ] **Ship** `X_NODE` and [docs](https://test)\n- [ ] Escape \\*literal\\*\n");
    expect(items.map((item) => [item.text, item.cancelled])).toEqual([
      ["Cancelled", true], ["Old New", false], ["Ship X_NODE and docs", false], ["Escape *literal*", false],
    ]);
  });

  it("flags quote lists without leaking quoted headings into document sections", () => {
    const items = extractBodyTodos("# Work\n> ## Example\n> - [ ] Quoted\n\n- [ ] Real\n");
    expect(items[0]).toMatchObject({ quoted: true });
    expect(items[1]).toMatchObject({ quoted: false, headings: ["Work"] });
  });

  it("resolves duplicate labels by position in an unchanged document", () => {
    const body = "- [ ] Test\n- [ ] Test\n";
    const second = extractBodyTodos(body)[1];
    expect(resolveBodyTodo(body, body, second)?.markerFrom).toBe(second.markerFrom);
  });

  it("relocates a unique item after unrelated text is inserted and refuses ambiguous edits", () => {
    const body = "## Release\n- [ ] Test\n";
    const item = extractBodyTodos(body)[0];
    expect(resolveBodyTodo("A new introduction\n\n" + body, body, item)?.markerFrom).toBe(item.markerFrom + 20);
    expect(resolveBodyTodo(body + "- [ ] Test\n", body, item)).toBeNull();
    expect(resolveBodyTodo("## Renamed\n- [ ] Test\n", body, item)).toBeNull();
  });

  it("does not merge formerly duplicated items when one is removed", () => {
    const original = "- [ ] Test\n- [ ] Test\n";
    expect(resolveBodyTodo("- [ ] Test\n", original, extractBodyTodos(original)[1])).toBeNull();
  });
});
