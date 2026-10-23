import { browser, expect, $, $$ } from "@wdio/globals";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-archive-e2e-"));
  await mkdir(join(workspacePath, "tasks", "project"), { recursive: true });
  for (const [id, title, status] of [
    ...Array.from({ length: 6 }, (_, index) => [`completed-${index}`, `Completed item ${index + 1}`, "done"]),
    ["pending", "Pending item", "doing"],
  ]) {
    await writeFile(join(workspacePath, "tasks", "project", `${title}.md`), `---\nid: ${id}\ntitle: ${title}\narchived: false\ncreatedAt: 2026-09-15T00:00:00Z\nupdatedAt: 2026-09-15T00:00:00Z\nstatus: ${status}\n---\n\nBody of ${title}.\n`);
  }
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Archive completed results", () => {
  it("defaults to all files and archives only the checked files", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await $("#workspace-path").waitForDisplayed();
    await $("#workspace-path").setValue(workspacePath);
    await $("//main/button").click();
    await $("[title='Completed item 1']").waitForDisplayed();
    await $("//button[contains(., '归档已完成') or contains(., 'Archive completed')]").click();
    await expect($("[role='dialog']")).toHaveText(/6/);
    await expect($$("[role='dialog'] li")).toBeElementsArrayOfSize(6);
    await expect($("[role='dialog'] li")).toHaveText(/Completed item 1/);
    await expect($("[role='dialog'] li")).toHaveText(/project\/Completed item 1\.md/);
    await expect($("[role='dialog']")).not.toHaveText(/Pending item/);
    const confirm = $("//div[@role='dialog']//button[contains(., '确认归档') or contains(., 'Archive tasks')]");
    const checkboxes = await $$("[role='dialog'] input[type='checkbox']");
    await expect(checkboxes).toBeElementsArrayOfSize(6);
    for (const checkbox of checkboxes) {
      await expect(checkbox).toBeChecked();
      await checkbox.click();
    }
    await expect(confirm).toBeDisabled();
    await $("//div[@role='dialog']//button[contains(., '取消') or contains(., 'Cancel')]").click();
    await $("//button[contains(., '归档已完成') or contains(., 'Archive completed')]").click();
    for (const checkbox of await $$("[role='dialog'] input[type='checkbox']")) await expect(checkbox).toBeChecked();
    await $("[role='dialog'] input[aria-label$='Completed item 6']").click();
    await expect($("[role='dialog'] p")).toHaveText(/5/);
    await confirm.click();
    await expect($("[role='status']")).toHaveText(/已归档 5 项|Archived 5/);
    for (let index = 1; index <= 5; index++) await access(join(workspacePath, "archive", "project", `Completed item ${index}.md`));
    await access(join(workspacePath, "tasks", "project", "Completed item 6.md"));
    await access(join(workspacePath, "tasks", "project", "Pending item.md"));
    await expect($("[title='Completed item 1']")).not.toExist();
    await expect($("[title='Completed item 6']")).toBeDisplayed();
    await $("button[aria-label='归档'], button[aria-label='Archive']").click();
    await $("[title='Completed item 1']").waitForDisplayed();
    await expect($("[title='Completed item 6']")).not.toExist();
    await $("button[aria-label='返回当前任务'], button[aria-label='Return to current tasks']").click();
    await $("//button[contains(., '归档已完成') or contains(., 'Archive completed')]").click();
    await expect($$("[role='dialog'] input[type='checkbox']")).toBeElementsArrayOfSize(1);
    await expect($("[role='dialog'] input[type='checkbox']")).toBeChecked();
    await $("//div[@role='dialog']//button[contains(., '确认归档') or contains(., 'Archive tasks')]").click();
    await expect($("[role='status']")).toHaveText(/已归档 1 项|Archived 1/);
    await access(join(workspacePath, "archive", "project", "Completed item 6.md"));
  });
});
