import { browser, expect, $ } from "@wdio/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-shortcut-e2e-"));
  await mkdir(join(workspacePath, "tasks"));
});

beforeEach(async () => {
  await writeFile(join(workspacePath, "tasks", "Task shortcut.md"), `---
id: task-shortcut
title: Task shortcut
archived: false
createdAt: 2026-10-15T00:00:00Z
updatedAt: 2026-10-15T00:00:00Z
---

任务内容

后续内容`);
  await browser.execute(() => {
    localStorage.clear();
    localStorage.setItem("taskmate.locale.v1", "en");
    localStorage.setItem("taskmate-editor-shortcuts.v1", JSON.stringify({ bullet: "Alt+Q", ordered: "Alt+W" }));
  });
  await browser.refresh();
  await $("#workspace-path").waitForDisplayed();
  await $("#workspace-path").setValue(workspacePath);
  await $("//main/button").click();
  await $("[title='Task shortcut']").waitForDisplayed();
  await $("[title='Task shortcut']").click();
  await $(".cm-editor").waitForDisplayed();
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Task list shortcut in the native editor", () => {
  for (const sourceMode of [false, true]) {
    for (const entry of ["toolbar", "shortcut"]) {
      it(`replaces list types through the ${entry} in ${sourceMode ? "source" : "preview"} mode`, async () => {
        if (sourceMode) {
          await $("button[aria-label='Task actions']").click();
          await browser.keys("ArrowDown");
          await $("//*[@role='menuitemcheckbox' and normalize-space(.)='Source mode']").click();
        }
        await focusEditorLine(0);
        await expect($(".cm-content")).toBeFocused();
        await expect($(".cm-line")).toHaveText("任务内容");
        await expect($(".cm-editor")).toHaveAttribute("data-selection-line", "1");

        const modifier = process.platform === "darwin" ? "Meta" : "Control";
        const lists = {
          bullet: { label: "Bullet list", keys: ["Alt", "q"], text: "- 任务内容" },
          ordered: { label: "Ordered list", keys: ["Alt", "w"], text: "1. 任务内容" },
          task: { label: "Task list", keys: [modifier, "l"], text: "- [ ] 任务内容" },
        };
        for (const type of ["bullet", "ordered", "task", "bullet", "task", "ordered", "bullet"] as const) {
          const list = lists[type];
          if (entry === "toolbar") {
            // The embedded driver's click() omits the mousedown used by formatting buttons.
            await browser.execute((label) => {
              document.querySelector(`button[aria-label^='${label}']`)!.dispatchEvent(
                new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
              );
            }, list.label);
          } else await browser.keys(list.keys);
          await expect($(".cm-line")).toHaveText(list.text);
          await expect($(".cm-editor")).toHaveAttribute("data-selection-text", "");
          await expect($(".cm-content")).toBeFocused();
        }
        await $(".cm-content").addValue(" next");
        await expect($(".cm-line")).toHaveText("- 任务内容 next");
      });
    }
    for (const blankLine of [false, true]) {
      it(`continues typing at the item end in ${sourceMode ? "source" : "preview"} mode on ${blankLine ? "a blank line" : "existing text"}`, async () => {
        if (sourceMode) {
          await $("button[aria-label='Task actions']").click();
          await browser.keys("ArrowDown");
          await $("//*[@role='menuitemcheckbox' and normalize-space(.)='Source mode']").click();
          await expect($("button[aria-label='Task actions']")).toBeFocused();
        }
        await focusEditorLine(blankLine ? 1 : 0);
        await expect($(".cm-content")).toBeFocused();
        await expect($(".cm-editor")).toHaveAttribute("data-selection-line", blankLine ? "2" : "1");
        await expect($(".cm-editor")).toHaveAttribute("data-selection-column", "0");
        const modifier = process.platform === "darwin" ? "Meta" : "Control";
        await browser.keys([modifier, "l"]);
        await expect($(".cm-editor")).toHaveAttribute("data-selection-column", blankLine ? "6" : "10");
        await expect($(".cm-editor")).toHaveAttribute("data-selection-text", "");
        await $(".cm-content").addValue(" next");
        await expect($(".cm-content")).toHaveText(blankLine ? /任务内容\s*- \[ \]  next\s*后续内容/ : /- \[ \] 任务内容 next\s*后续内容/);
      });
    }
  }
});

async function focusEditorLine(lineIndex: number) {
  // The embedded driver does not position contenteditable carets with click().
  await browser.execute((index) => {
    const line = document.querySelectorAll<HTMLElement>(".cm-line")[index];
    const rect = line.getBoundingClientRect();
    const clientX = rect.left + 2;
    const clientY = rect.top + rect.height / 2;
    const target = document.elementFromPoint(clientX, clientY)!;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, detail: 1, clientX, clientY }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, buttons: 0, detail: 1, clientX, clientY }));
  }, lineIndex);
}
