import { browser, expect, $ } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: workspacePath, encoding: "utf8" }).trim();

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-git-e2e-"));
  await mkdir(join(workspacePath, "tasks"));
  await writeFile(join(workspacePath, "tasks", "Today.md"), `---
id: today
title: Today
archived: false
createdAt: 2026-09-15T00:00:00Z
updatedAt: 2026-09-15T00:00:00Z
---

Plan the day.
`);
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Taskmate Test");
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Git commit messages", () => {
  it("generates a fresh summary for each commit and preserves custom messages", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await $("#workspace-path").waitForDisplayed();
    await $("#workspace-path").setValue(workspacePath);
    await $("//main/button").click();
    await $("[title='Today']").waitForDisplayed();
    git("add", "-A");
    git("commit", "-m", "Initial workspace");
    await writeFile(join(workspacePath, "notes.md"), "Prepare the meeting\n");
    await $("a[aria-label='Git backup'], a[aria-label='Git 备份']").click();

    const message = $("//label[contains(., 'Commit message') or contains(., '提交说明')]/input");
    const commit = $("//button[normalize-space(.)='Commit' or normalize-space(.)='提交']");
    const history = $("ol[aria-label='Recent history'], ol[aria-label='最近提交']");
    await expect(message).toHaveValue("");
    await expect($("ul[aria-label='Modified files'], ul[aria-label='已修改文件']")).toHaveText(/notes\.md/);
    await commit.click();
    await expect(history).toHaveText(/Add notes\.md/);
    await expect(commit).toBeEnabled();
    expect(git("log", "-1", "--format=%s")).toBe("Add notes.md");
    expect(git("log", "-1", "--format=%B")).toContain("1 insertion(+)");

    await writeFile(join(workspacePath, "notes.md"), "Prepare the meeting\nReview the agenda\n");
    await commit.click();
    await expect(history).toHaveText(/Update notes\.md/);
    await expect(commit).toBeEnabled();
    expect(git("log", "-1", "--format=%s")).toBe("Update notes.md");

    await writeFile(join(workspacePath, "notes.md"), "Prepare the meeting\nFinalize the agenda\n");
    await message.setValue("Finalize meeting agenda");
    await commit.click();
    await expect(history).toHaveText(/Finalize meeting agenda/);
    await expect(commit).toBeEnabled();
    await expect(message).toHaveValue("");
    expect(git("log", "-1", "--format=%s")).toBe("Finalize meeting agenda");
    expect(git("log", "-1", "--format=%B")).toContain("- Update notes.md");
  });
});
