import { browser, expect, $ } from "@wdio/globals";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

let workspacePath: string;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-delete-e2e-"));
  for (const archived of [false, true]) {
    const directory = join(workspacePath, archived ? "archive" : "tasks", "project");
    const title = archived ? "Archived task" : "Active task";
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${title}.md`), `---\nid: delete-${archived}\ntitle: ${title}\narchived: ${archived}\ncreatedAt: 2026-11-04T00:00:00Z\nupdatedAt: 2026-11-04T00:00:00Z\n---\n\nTask body.\n`);
  }
  await browser.execute(() => {
    localStorage.clear();
    localStorage.setItem("taskmate.locale.v1", "en");
  });
  await browser.refresh();
  await $("#workspace-path").waitForDisplayed();
  await $("#workspace-path").setValue(workspacePath);
  await $("//main/button").click();
  await $("[title='Active task']").waitForDisplayed();
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Delete a task through the native task actions menu", () => {
  for (const archived of [false, true]) {
    it(`cancels and then permanently deletes an ${archived ? "archived" : "active"} task`, async () => {
      const title = archived ? "Archived task" : "Active task";
      const filePath = join(workspacePath, archived ? "archive" : "tasks", "project", `${title}.md`);
      if (archived) await $("button[aria-label='Archive']").click();
      await $(`[title='${title}']`).waitForDisplayed();
      await $(`[title='${title}']`).click();
      await expect($("input[aria-label='Task title']")).toHaveValue(title);
      await $("button[aria-label='Task actions']").click();
      await browser.keys("ArrowDown");
      await $("//*[@role='menuitem' and normalize-space(.)='Permanently delete']").waitForDisplayed();
      await $("//*[@role='menuitem' and normalize-space(.)='Permanently delete']").click();
      await expect($("[role='dialog']")).toHaveText(expect.stringContaining(`Permanently delete “${title}”? This cannot be undone.`));
      await $("//div[@role='dialog']//button[normalize-space(.)='Cancel']").click();
      await expect($("[role='dialog']")).not.toExist();
      await expect($("input[aria-label='Task title']")).toHaveValue(title);
      await expect($("button[aria-label='Task actions']")).toBeFocused();
      await access(filePath);

      await $("button[aria-label='Task actions']").click();
      await browser.keys("ArrowDown");
      await $("//*[@role='menuitem' and normalize-space(.)='Permanently delete']").waitForDisplayed();
      await $("//*[@role='menuitem' and normalize-space(.)='Permanently delete']").click();
      await $("//div[@role='dialog']//button[normalize-space(.)='Permanently delete']").click();
      await expect($("[role='dialog']")).not.toExist();
      await expect($(`[title='${title}']`)).not.toExist();
      await expect($("input[aria-label='Task title']")).not.toExist();
      await expect($("[role='tab']")).not.toExist();
      await assert.rejects(access(filePath), { code: "ENOENT" });
      await browser.refresh();
      await $("[role='toolbar'][aria-label='Task list']").waitForDisplayed();
      await expect($(`[title='${title}']`)).not.toExist();
      await expect($("[role='alert']")).not.toExist();
    });
  }
});
