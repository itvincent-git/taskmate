import { browser, expect, $ } from "@wdio/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;
const taskBody = `active

这是memcheck的日志：.artifacts/ssr-oom/remote/20260911T130516Z\u0020

这是k6的日志.artifacts/ssr-oom/remote/20260911T130516Z
分析问题，如何改进算法？

Select **target text** across this line
and finish on this second line.

### 00

这是优化完联赛页后的 http 日志。`;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-e2e-"));
  await mkdir(join(workspacePath, "tasks"));
  await writeFile(join(workspacePath, "tasks", "Click positioning.md"), `---
id: click-positioning
title: Click positioning
archived: false
createdAt: 2026-09-15T00:00:00Z
updatedAt: 2026-09-15T00:00:00Z
---

${taskBody}`);
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Taskmate desktop page", () => {
  it("loads inside the Tauri WebView", async () => {
    await expect(browser).toHaveTitle("Taskmate");
    await expect($("#root")).toBeDisplayed();

    const hasTauriRuntime = await browser.execute(
      () => "__TAURI_INTERNALS__" in window,
    );
    expect(hasTauriRuntime).toBe(true);
  });

  it("positions the cursor at the clicked text before mouseup", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await $("#workspace-path").waitForDisplayed();
    await $("#workspace-path").setValue(workspacePath);
    await $("//main/button").click();
    const taskTitle = await $("[title='Click positioning']");
    await taskTitle.waitForDisplayed();
    await taskTitle.click();
    await $(".cm-editor").waitForDisplayed();

    const targetLine = await $("//*[contains(concat(' ', normalize-space(@class), ' '), ' cm-line ') and contains(., 'memcheck的日志')]");
    const offset = await browser.execute(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
        .find((candidate) => candidate.textContent?.includes("memcheck的日志"))!;
      const node = Array.from(line.childNodes)
        .find((candidate) => candidate.textContent?.includes("memcheck的日志"))!;
      const textOffset = node.textContent!.indexOf("memcheck") + 3;
      const range = document.createRange();
      range.setStart(node, textOffset);
      range.setEnd(node, textOffset + 1);
      const rect = range.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      return {
        x: Math.round(rect.left + 1 - (lineRect.left + lineRect.width / 2)),
        y: Math.round(rect.top + rect.height / 2 - (lineRect.top + lineRect.height / 2)),
        column: textOffset,
      };
    });
    const targetLineNumber = await browser.execute((element) =>
      Array.from(document.querySelectorAll(".cm-line")).indexOf(element as unknown as Element) + 1, targetLine);
    const point = await browser.execute((element, relative) => {
      const rect = (element as unknown as HTMLElement).getBoundingClientRect();
      const clientX = rect.left + rect.width / 2 + relative.x;
      const clientY = rect.top + rect.height / 2 + relative.y;
      const target = document.elementFromPoint(clientX, clientY);
      if (!target) throw new Error("Unable to find click target");
      target.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true, button: 0, buttons: 1, detail: 1, clientX, clientY,
      }));
      return { x: clientX, y: clientY };
    }, targetLine, offset);
    try {
      await expect($(".cm-editor")).toHaveAttribute("data-selection-line", String(targetLineNumber));
      await expect($(".cm-editor")).toHaveAttribute("data-selection-column", String(offset.column));
    } finally {
      await browser.execute((position) => document.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true, button: 0, buttons: 0, detail: 1, clientX: position.x, clientY: position.y,
      })), point);
    }
  });

  it("selects rendered Markdown text across lines in both directions", async () => {
    const startLine = await $("//*[contains(concat(' ', normalize-space(@class), ' '), ' cm-line ') and contains(., 'target text')]");
    const endLine = await $("//*[contains(concat(' ', normalize-space(@class), ' '), ' cm-line ') and contains(., 'finish on')]");
    const pointInText = async (line: ReturnType<typeof $>, needle: string, character: number, after: boolean) => browser.execute(
      (element, text, offset, placeAfter) => {
        const lineElement = element as unknown as HTMLElement;
        const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
        let node: Text | null = null;
        while (walker.nextNode()) {
          const candidate = walker.currentNode as Text;
          if (candidate.data.includes(text)) {
            node = candidate;
            break;
          }
        }
        if (!node) throw new Error(`Unable to find ${text}`);
        const position = node.data.indexOf(text) + offset;
        const range = document.createRange();
        range.setStart(node, position);
        range.setEnd(node, position + 1);
        const rect = range.getBoundingClientRect();
        return {
          x: Math.round(placeAfter ? rect.right - 1 : rect.left + 1),
          y: Math.round(rect.top + rect.height / 2),
        };
      },
      line,
      needle,
      character,
      after,
    );
    const expectedText = "target text** across this line\nand finish";
    const drag = (start: { x: number; y: number }, end: { x: number; y: number }) => browser.execute(
      (from, to) => {
        const target = document.elementFromPoint(from.x, from.y);
        if (!target) throw new Error("Unable to find drag start target");
        target.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true, button: 0, buttons: 1, detail: 1, clientX: from.x, clientY: from.y,
        }));
        document.dispatchEvent(new MouseEvent("mousemove", {
          bubbles: true, button: 0, buttons: 1, detail: 1, clientX: to.x, clientY: to.y,
        }));
        document.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true, button: 0, buttons: 0, detail: 1, clientX: to.x, clientY: to.y,
        }));
      },
      start,
      end,
    );

    await drag(
      await pointInText(startLine, "target text", 0, false),
      await pointInText(endLine, "finish", "finish".length - 1, true),
    );
    await expect($(".cm-editor")).toHaveAttribute("data-selection-text", expectedText);
    await browser.waitUntil(async () => Number(await $(".cm-editor").getAttribute("data-selection-anchor"))
      < Number(await $(".cm-editor").getAttribute("data-selection-head")));

    await drag(
      await pointInText(endLine, "finish", "finish".length - 1, true),
      await pointInText(startLine, "target text", 0, false),
    );
    await expect($(".cm-editor")).toHaveAttribute("data-selection-text", expectedText);
    await browser.waitUntil(async () => Number(await $(".cm-editor").getAttribute("data-selection-anchor"))
      > Number(await $(".cm-editor").getAttribute("data-selection-head")));
  });

  it("leaves an edited heading and positions the cursor in clicked paragraph text", async () => {
    const headingSelector = "//*[contains(concat(' ', normalize-space(@class), ' '), ' cm-line ') and contains(., '00')]";
    const paragraphSelector = "//*[contains(concat(' ', normalize-space(@class), ' '), ' cm-line ') and contains(., '这是优化完联赛页')]";
    const heading = await $(headingSelector);
    const offsetInText = (line: ReturnType<typeof $>, needle: string, character: number) => browser.execute(
      (element, text, offset) => {
        const lineElement = element as unknown as HTMLElement;
        const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const start = node.data.indexOf(text);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start + offset);
          range.setEnd(node, start + offset + 1);
          const rect = range.getBoundingClientRect();
          const lineRect = lineElement.getBoundingClientRect();
          return {
            x: Math.round(rect.left + 1 - (lineRect.left + lineRect.width / 2)),
            y: Math.round(rect.top + rect.height / 2 - (lineRect.top + lineRect.height / 2)),
          };
        }
        throw new Error(`Unable to find ${text}`);
      },
      line,
      needle,
      character,
    );
    const clickAt = (line: ReturnType<typeof $>, offset: { x: number; y: number }) => browser.execute(
      (element, point) => {
        const rect = (element as unknown as HTMLElement).getBoundingClientRect();
        const clientX = rect.left + rect.width / 2 + point.x;
        const clientY = rect.top + rect.height / 2 + point.y;
        const target = document.elementFromPoint(clientX, clientY);
        if (!target) throw new Error("Unable to find click target");
        target.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true, button: 0, buttons: 1, detail: 1, clientX, clientY,
        }));
        target.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true, button: 0, buttons: 0, detail: 1, clientX, clientY,
        }));
      },
      line,
      offset,
    );

    const headingLine = await browser.execute((element) =>
      Array.from(document.querySelectorAll(".cm-line")).indexOf(element as unknown as Element) + 1, heading);
    const headingOffset = await offsetInText(heading, "00", 1);
    await clickAt(heading, headingOffset);
    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", String(headingLine));
    await browser.waitUntil(async () => await $(".cm-editor").getAttribute("data-selection-anchor")
      === await $(".cm-editor").getAttribute("data-selection-head"));
    await browser.execute(() => document.execCommand("insertText", false, "x"));
    await browser.waitUntil(() => browser.execute((lineNumber) =>
      document.querySelectorAll(".cm-line")[lineNumber - 1]?.textContent?.includes("x") ?? false, headingLine));

    const targetCharacter = 7;
    const paragraph = await $(paragraphSelector);
    const paragraphLine = await browser.execute((element) =>
      Array.from(document.querySelectorAll(".cm-line")).indexOf(element as unknown as Element) + 1, paragraph);
    const paragraphOffset = await offsetInText(paragraph, "这是优化完联赛页", targetCharacter);
    await clickAt(paragraph, paragraphOffset);

    await browser.waitUntil(() => browser.execute((lineNumber) =>
      !document.querySelectorAll(".cm-line")[lineNumber - 1]?.textContent?.includes("###"), headingLine));
    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", String(paragraphLine));
    await expect($(".cm-editor")).toHaveAttribute("data-selection-column", String(targetCharacter));
  });
});
