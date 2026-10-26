import { browser, expect, $ } from "@wdio/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-tab-order-e2e-"));
  await mkdir(join(workspacePath, "tasks"));
  for (const title of ["First task", "Second task"]) {
    await writeFile(join(workspacePath, "tasks", `${title}.md`), `---
id: ${title}
title: ${title}
archived: false
createdAt: 2026-10-26T00:00:00Z
updatedAt: 2026-10-26T00:00:00Z
---

${title} body`);
  }
  await browser.execute(() => {
    localStorage.clear();
    localStorage.setItem("taskmate.locale.v1", "en");
  });
  await browser.refresh();
  await $("#workspace-path").waitForDisplayed();
  await $("#workspace-path").setValue(workspacePath);
  await $("//main/button").click();
  for (const title of ["First task", "Second task"]) {
    await $(`[title='${title}']`).waitForDisplayed();
    await $(`[title='${title}']`).click();
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText(title);
  }
  await $("a[href='#/properties']").click();
  await $("a[href='#/settings']").click();
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

async function tabTitles() {
  return browser.execute(() => Array.from(document.querySelectorAll("[role='tab']"))
    .map((tab) => tab.querySelector("button")!.textContent));
}

async function dragTab(from: number, to: number) {
  // The embedded driver emits MouseEvents for pointer actions. Dispatch pointer
  // events in the real WebView and emulate capture for these synthetic events.
  await browser.execute((sourceIndex, targetIndex) => {
    const tabs = document.querySelectorAll("[role='tab']");
    const sourceButton = tabs[sourceIndex].querySelector("button")!;
    const source = sourceButton.getBoundingClientRect();
    const target = tabs[targetIndex].getBoundingClientRect();
    const tablist = document.querySelector<HTMLElement>("[role='tablist']")!;
    const capture = tablist.setPointerCapture;
    tablist.setPointerCapture = () => {};
    const clientX = sourceIndex < targetIndex ? target.right - 8 : target.left + 8;
    const clientY = target.top + target.height / 2;
    try {
      sourceButton.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, button: 0, buttons: 1, pointerId: 1,
        clientX: source.left + source.width / 2, clientY: source.top + source.height / 2,
      }));
      tablist.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, buttons: 1, pointerId: 1, clientX, clientY,
      }));
      tablist.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, button: 0, pointerId: 1, clientX, clientY,
      }));
      tablist.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX, clientY }));
    } finally {
      tablist.setPointerCapture = capture;
    }
  }, from, to);
}

describe("Tab order in the native app", () => {
  it("drags file and page tabs in both directions and restores their order", async () => {
    expect(await tabTitles()).toEqual(["First task", "Second task", "Properties", "Settings"]);
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");

    await dragTab(0, 3);

    await browser.waitUntil(async () => JSON.stringify(await tabTitles())
      === JSON.stringify(["Second task", "Properties", "Settings", "First task"]));
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");
    await browser.refresh();
    await $("[role='tab']").waitForDisplayed();
    expect(await tabTitles()).toEqual(["Second task", "Properties", "Settings", "First task"]);
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");

    await dragTab(2, 0);

    await browser.waitUntil(async () => JSON.stringify(await tabTitles())
      === JSON.stringify(["Settings", "Second task", "Properties", "First task"]));
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");
    await $("[data-tab-key='task:First task'] button").click();
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("First task");
    await $("button[aria-label='Close tab: First task']").click();
    expect(await tabTitles()).toEqual(["Settings", "Second task", "Properties"]);
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Properties");
  });
});
