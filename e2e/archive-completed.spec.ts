import { browser, expect, $ } from "@wdio/globals";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-archive-e2e-"));
  await mkdir(join(workspacePath, "tasks", "project"), { recursive: true });
  for (const [id, title, status] of [["completed", "Completed item", "done"], ["pending", "Pending item", "doing"]]) {
    await writeFile(join(workspacePath, "tasks", "project", `${title}.md`), `---\nid: ${id}\ntitle: ${title}\narchived: false\ncreatedAt: 2026-09-15T00:00:00Z\nupdatedAt: 2026-09-15T00:00:00Z\nstatus: ${status}\n---\n\nBody of ${title}.\n`);
  }
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Archive completed results", () => {
  it("moves completed files to the matching archive folder and shows them in Archive", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await $("#workspace-path").waitForDisplayed();
    await $("#workspace-path").setValue(workspacePath);
    await $("//main/button").click();
    await $("[title='Completed item']").waitForDisplayed();
    await $("//button[contains(., '归档已完成') or contains(., 'Archive completed')]").click();
    await expect($("[role='dialog']")).toHaveText(/1/);
    await expect($("[role='dialog'] li")).toHaveText(/Completed item/);
    await expect($("[role='dialog'] li")).toHaveText(/project\/Completed item\.md/);
    await expect($("[role='dialog'] li")).not.toHaveText(/Pending item/);
    await $("//div[@role='dialog']//button[contains(., '确认归档') or contains(., 'Archive tasks')]").click();
    await expect($("[role='status']")).toHaveText(/已归档 1 项|Archived 1/);
    await access(join(workspacePath, "archive", "project", "Completed item.md"));
    await access(join(workspacePath, "tasks", "project", "Pending item.md"));
    await expect($("[title='Completed item']")).not.toExist();
    await $("button[aria-label='归档'], button[aria-label='Archive']").click();
    await $("[title='Completed item']").waitForDisplayed();
  });
});
