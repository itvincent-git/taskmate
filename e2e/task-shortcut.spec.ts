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
    for (const blankLine of [false, true]) {
      it(`continues typing at the item end in ${sourceMode ? "source" : "preview"} mode on ${blankLine ? "a blank line" : "existing text"}`, async () => {
        if (sourceMode) {
          await $("button[aria-label='Task actions']").click();
          await browser.keys("ArrowDown");
          await $("//*[@role='menuitemcheckbox' and normalize-space(.)='Source mode']").click();
          await expect($("button[aria-label='Task actions']")).toBeFocused();
        }
        // The embedded driver does not position contenteditable carets with click().
        await browser.execute((lineIndex) => {
          const line = document.querySelectorAll<HTMLElement>(".cm-line")[lineIndex];
          const rect = line.getBoundingClientRect();
          const clientX = rect.left + 2;
          const clientY = rect.top + rect.height / 2;
          const target = document.elementFromPoint(clientX, clientY)!;
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, detail: 1, clientX, clientY }));
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, buttons: 0, detail: 1, clientX, clientY }));
        }, blankLine ? 1 : 0);
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
