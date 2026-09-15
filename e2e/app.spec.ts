import { browser, expect, $ } from "@wdio/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;

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

active

这是memcheck的日志：.artifacts/ssr-oom/remote/20260911T130516Z\u0020

这是k6的日志.artifacts/ssr-oom/remote/20260911T130516Z
分析问题，如何改进算法？`);
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

  it("positions the cursor on the clicked line before a multiline preview", async () => {
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
        x: Math.round(rect.left + rect.width / 2 - (lineRect.left + lineRect.width / 2)),
        y: Math.round(rect.top + rect.height / 2 - (lineRect.top + lineRect.height / 2)),
      };
    });
    await targetLine.click({ x: offset.x, y: offset.y });

    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", "3");
  });
});
