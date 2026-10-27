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

async function pressTab(index: number, moveImmediately = false) {
  // The embedded driver emits MouseEvents for pointer actions. Dispatch pointer
  // events in the real WebView and emulate capture for these synthetic events.
  await browser.execute((sourceIndex, immediate) => {
    const tabs = document.querySelectorAll("[role='tab']");
    const sourceButton = tabs[sourceIndex].querySelector("button")!;
    const source = tabs[sourceIndex].getBoundingClientRect();
    const tablist = document.querySelector<HTMLElement>("[role='tablist']")!;
    const capture = tablist.setPointerCapture;
    tablist.setPointerCapture = () => {};
    const restore = () => {
      tablist.setPointerCapture = capture;
      tablist.removeEventListener("pointerup", restore);
      tablist.removeEventListener("pointercancel", restore);
    };
    tablist.addEventListener("pointerup", restore);
    tablist.addEventListener("pointercancel", restore);
    sourceButton.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, buttons: 1, pointerId: 1,
      clientX: source.left + source.width / 2, clientY: source.top + source.height / 2,
    }));
    if (immediate) {
      tablist.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, buttons: 1, pointerId: 1, clientX: source.right + 300, clientY: source.top + 16,
      }));
      tablist.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    }
  }, index, moveImmediately);
}

async function releaseTab(cancel = false) {
  await browser.execute((cancelled) => {
    const tablist = document.querySelector("[role='tablist']")!;
    tablist.dispatchEvent(new PointerEvent(cancelled ? "pointercancel" : "pointerup", {
      bubbles: true, button: 0, pointerId: 1,
    }));
    tablist.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, cancel);
  await expect($("[data-tab-drag-preview]")).not.toExist();
  await expect($("[data-tab-drop-indicator]")).not.toExist();
}

async function moveTab(from: number, to: number) {
  return browser.execute((sourceIndex, targetIndex) => {
    const tabs = document.querySelectorAll("[role='tab']");
    const source = tabs[sourceIndex].getBoundingClientRect();
    const target = tabs[targetIndex].getBoundingClientRect();
    const clientX = sourceIndex < targetIndex ? target.right - 8 : target.left + 8;
    const clientY = target.top + target.height / 2 + 16;
    document.querySelector("[role='tablist']")!.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, buttons: 1, pointerId: 1, clientX, clientY,
    }));
    return {
      deltaX: clientX - (source.left + source.width / 2), deltaY: 16,
      indicatorX: sourceIndex < targetIndex ? target.right + 1 : target.left - 1,
    };
  }, from, to);
}

async function dragTab(from: number, to: number) {
  const originalOrder = await tabTitles();
  await pressTab(from);
  await $("[data-tab-drag-preview]").waitForExist();
  const preview = $("[data-tab-drag-preview]");
  await expect(preview).toHaveText(originalOrder[from]!);
  const initialBounds = await preview.getLocation();
  const sourceSize = await browser.execute((index) => {
    const { width, height } = document.querySelectorAll("[role='tab']")[index].getBoundingClientRect();
    return { width, height };
  }, from);
  expect(await preview.getSize()).toEqual(sourceSize);
  const { deltaX, deltaY, indicatorX } = await moveTab(from, to);
  const movedBounds = await preview.getLocation();
  expect(movedBounds.x - initialBounds.x).toBeCloseTo(deltaX, 0);
  expect(movedBounds.y - initialBounds.y).toBeCloseTo(deltaY, 0);
  const indicator = $("[data-tab-drop-indicator]");
  await expect(indicator).toBeDisplayed();
  expect((await indicator.getLocation()).x).toBeCloseTo(indicatorX - 1, 0);
  expect(await tabTitles()).toEqual(originalOrder);
  await releaseTab();
}

describe("Tab order in the native app", () => {
  it("requires a long press and cancels without changing the order", async () => {
    const originalOrder = await tabTitles();
    await pressTab(0, true);
    await releaseTab();
    expect(await tabTitles()).toEqual(originalOrder);

    await pressTab(0);
    await $("[data-tab-drag-preview]").waitForExist();
    await moveTab(0, 3);
    await releaseTab(true);
    expect(await tabTitles()).toEqual(originalOrder);
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");
  });

  it("drags file and page tabs in both directions and restores their order", async () => {
    expect(await tabTitles()).toEqual(["First task", "Second task", "Properties", "Settings"]);
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");

    await dragTab(0, 2);

    await browser.waitUntil(async () => JSON.stringify(await tabTitles())
      === JSON.stringify(["Second task", "Properties", "First task", "Settings"]));
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");
    await browser.refresh();
    await $("[role='tab']").waitForDisplayed();
    expect(await tabTitles()).toEqual(["Second task", "Properties", "First task", "Settings"]);
    await expect($("[role='tab'][aria-selected='true'] button")).toHaveText("Settings");

    await dragTab(3, 0);

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
