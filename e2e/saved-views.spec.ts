import { browser, expect, $, $$ } from "@wdio/globals";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;
let viewsPath: string;
const views = "button[aria-label='Work views']";

async function openViews() {
  if (!await $("[role='menu']").isExisting()) {
    // The embedded driver sends MouseEvents; use the same keyboard opener as other Radix menu specs.
    await $(views).click();
    await browser.keys("ArrowDown");
  }
  await $("[role='menu']").waitForDisplayed();
}

async function viewAction(name: string) {
  await openViews();
  await $(`//*[@role='menuitem' and normalize-space(.)='${name}']`).click();
}

async function select(label: string, option: string) {
  if (label === "Work views") await openViews();
  else await $(`button[aria-label='${label}']`).click();
  await $(`//*[@role='${label === "Work views" ? "menuitemcheckbox" : "option"}' and normalize-space(.)='${option}']`).click();
}

async function saveAs(name: string) {
  await viewAction("Save as view");
  await $("[role='dialog'] input").setValue(name);
  await $("[role='dialog'] button[type='submit']").click();
  await $("[role='dialog']").waitForExist({ reverse: true });
  await expect($(views)).toHaveText(expect.stringContaining(name));
}

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-views-e2e-"));
  viewsPath = join(workspacePath, ".task-app", "views.json");
  await mkdir(join(workspacePath, "tasks"), { recursive: true });
  await mkdir(join(workspacePath, "archive", "project", "child"), { recursive: true });
  const now = new Date().toISOString();
  for (const [id, title, folder, archived, status] of [
    ["current-view-task", "Current work item", "", false, "in-progress"],
    ["archived-view-task", "Matching archived item", "project/child", true, "done"],
    ["other-view-task", "Other archived item", "", true, "done"],
  ] as const) {
    await writeFile(join(workspacePath, archived ? "archive" : "tasks", folder, `${title}.md`), `---\nid: ${id}\ntitle: ${title}\narchived: ${archived}\ncreatedAt: ${now}\nupdatedAt: ${now}\nstatus: ${status}\npriority: high\n---\n\nBody of ${title}.\n`);
  }
});

after(async () => { await rm(workspacePath, { recursive: true, force: true }); });

describe("Saved work views in the native application", () => {
  it("saves combined conditions, switches scopes and restores persisted and modified queries", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("taskmate.locale.v1", "en"); localStorage.setItem("taskmate-task-list-width.v1", "290"); });
    await browser.refresh();
    await $("#workspace-path").waitForDisplayed();
    await $("#workspace-path").setValue(workspacePath);
    await $("//main/button").click();
    await $("article [title='Current work item']").waitForDisplayed();
    await expect($(views)).toHaveText(expect.stringContaining("All tasks"));
    await expect($("button[aria-label='Save as view']")).not.toExist();
    const inToolbar = await browser.execute(() => {
      const trigger = document.querySelector("button[aria-label='Work views']")!;
      const toolbar = trigger.closest("[role='toolbar']")!;
      const folders = document.querySelector("section[aria-label='Folders']")!;
      return toolbar.nextElementSibling === folders && trigger.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().bottom;
    });
    expect(inToolbar).toBe(true);
    await access(viewsPath).then(() => { throw new Error("Views file was created before the first save"); }, () => {});

    await $("button[aria-label='Archive']").click();
    await $("button[aria-label='Expand project']").click();
    await $("button[title='project/child']").click();
    await $("button[aria-label='Open filters and sorting']").click();
    await select("Status Filter", "Done");
    await select("Updated time", "Updated in the last N days");
    await expect($("input[aria-label='Number of days']")).toHaveValue("7");
    await select("Sort 1", "Priority · Desc");
    await $("//button[normalize-space(.)='Add sort']").click();
    await select("Sort 2", "Updated time · Asc");
    await $("[role='dialog'] button[aria-label='Close']").click();
    await saveAs("Recent archive");
    const file = JSON.parse(await readFile(viewsPath, "utf8"));
    expect(file.version).toBe(1);
    expect(file.views).toHaveLength(1);
    expect(file.views[0]).toMatchObject({ name: "Recent archive", archived: true, folderPath: "project/child", filters: [{ key: "status", operator: "eq", value: "done" }, { key: "updatedAt", operator: "withinLastDays", value: 7 }], sorts: [{ key: "priority", direction: "desc", nulls: "last" }, { key: "updatedAt", direction: "asc", nulls: "last" }] });

    await $("button[aria-label='Open filters and sorting']").click();
    await $("//button[normalize-space(.)='Reset query conditions']").click();
    await $("[role='dialog'] button[aria-label='Close']").click();
    await $("button[aria-label='Return to current tasks']").click();
    await saveAs("Current work");
    await expect($("article [title='Current work item']")).toBeDisplayed();
    await select("Work views", "Recent archive");
    await $("article [title='Matching archived item']").waitForDisplayed();
    await expect($("article [title='Other archived item']")).not.toExist();
    await expect($("button[aria-label='Return to current tasks']")).toHaveAttribute("aria-pressed", "true");
    await expect($("[aria-current='true'] > button[title='project/child']")).toBeDisplayed();
    await expect($("input[aria-label='Task title']")).toHaveValue("Current work item");

    await browser.refresh();
    await $("article [title='Matching archived item']").waitForDisplayed();
    await expect($(views)).toHaveText(expect.stringContaining("Recent archive"));
    await $("//section[@aria-label='Folders']//button[normalize-space(.)='All tasks']").click();
    await expect($(views)).toHaveText(expect.stringContaining("Recent archive · Modified"));
    await browser.refresh();
    await expect($(views)).toHaveText(expect.stringContaining("Recent archive · Modified"));
    await viewAction("Restore saved conditions");
    await expect($(`${views} [aria-live='polite']`)).not.toExist();
    await expect($(views)).toHaveText(expect.stringContaining("Recent archive"));
    await expect($("article [title='Other archived item']")).not.toExist();
    await $("button[aria-label='Open filters and sorting']").click();
    await expect($("button[aria-label='Status Filter']")).toHaveText("Done");
    await expect($("input[aria-label='Number of days']")).toHaveValue("7");
    await expect($("button[aria-label='Sort 2']")).toHaveText("Updated time · Asc");
    await $("[role='dialog'] button[aria-label='Close']").click();
  });

  it("watches external view edits, protects corrupt files and displays long names in a narrow sidebar", async () => {
    const file = JSON.parse(await readFile(viewsPath, "utf8"));
    file.views[0].name = "A long saved view name that must fit within the narrow task sidebar";
    await writeFile(viewsPath, JSON.stringify(file));
    await expect($(views)).toHaveText(expect.stringContaining(file.views[0].name));
    const fits = await browser.execute(() => {
      const button = document.querySelector("button[aria-label='Work views']")!.getBoundingClientRect();
      const panel = document.querySelector("#task-side-panel")!.getBoundingClientRect();
      const label = document.querySelector("button[aria-label='Work views'] span[title]")!;
      return button.right <= panel.right && button.width > 100 && panel.width === 290 && label.scrollWidth > label.clientWidth;
    });
    expect(fits).toBe(true);
    await browser.saveScreenshot("/tmp/taskmate-saved-views.png");
    await openViews();
    await browser.saveScreenshot("/tmp/taskmate-view-menu.png");
    await browser.keys("Escape");
    await writeFile(viewsPath, "broken views file");
    await $(`${views} svg[aria-label]`).waitForDisplayed();
    await openViews();
    await $("[role='alert']").waitForDisplayed();
    await expect($("//*[@role='menuitem' and normalize-space(.)='Save as view']")).toHaveAttribute("aria-disabled", "true");
    await expect($("article [title='Matching archived item']")).toBeDisplayed();
    expect(await readFile(viewsPath, "utf8")).toBe("broken views file");
    await writeFile(viewsPath, JSON.stringify(file));
    await expect($("//*[@role='menuitem' and normalize-space(.)='Save as view']")).not.toHaveAttribute("aria-disabled", "true");
    await $("[role='alert']").waitForExist({ reverse: true });
    await viewAction("Manage views");
    await expect($$("[role='dialog'] button")).toBeElementsArrayOfSize(7);
    await browser.keys("Escape");
    await $("[role='dialog']").waitForExist({ reverse: true });
    await expect($(views)).toBeFocused();
    await openViews();
    await browser.keys("Escape");
    await $("[role='menu']").waitForExist({ reverse: true });
    await expect($(views)).toBeFocused();
    await select("Work views", "All tasks");
    await $("article [title='Current work item']").waitForDisplayed();
    await expect($(views)).toHaveText(expect.stringContaining("All tasks"));
    await expect($("button[aria-label='Archive']")).toHaveAttribute("aria-pressed", "false");
  });
});
