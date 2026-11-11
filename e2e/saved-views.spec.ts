import { browser, expect, $, $$ } from "@wdio/globals";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;
let viewsPath: string;
const views = "button[aria-label='Work views']";

async function select(label: string, option: string) {
  await $(`button[aria-label='${label}']`).click();
  await $(`//*[@role='option' and normalize-space(.)='${option}']`).click();
}

async function saveAs(name: string) {
  await $("button[aria-label='Save as view']").click();
  await $("[role='dialog'] input").setValue(name);
  await $("[role='dialog'] button[type='submit']").click();
  await $("[role='dialog']").waitForExist({ reverse: true });
  await expect($(views)).toHaveText(name);
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
    await expect($(views)).toHaveText("Custom");
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
    await expect($(views)).toHaveText("Recent archive");
    await $("//section[@aria-label='Folders']//button[normalize-space(.)='All tasks']").click();
    await expect($(views)).toHaveText("Recent archive · Modified");
    await browser.refresh();
    await expect($(views)).toHaveText("Recent archive · Modified");
    await $("//button[normalize-space(.)='Restore saved conditions']").click();
    await expect($(views)).toHaveText("Recent archive");
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
    await expect($(views)).toHaveText(file.views[0].name);
    const fits = await browser.execute(() => {
      const button = document.querySelector("button[aria-label='Work views']")!.getBoundingClientRect();
      const panel = document.querySelector("#task-side-panel")!.getBoundingClientRect();
      return button.right <= panel.right && button.width > 100 && panel.width === 290;
    });
    expect(fits).toBe(true);
    await browser.saveScreenshot("/tmp/taskmate-saved-views.png");
    await writeFile(viewsPath, "broken views file");
    await $("[role='alert']").waitForDisplayed();
    await expect($("button[aria-label='Save as view']")).toBeDisabled();
    await expect($("article [title='Matching archived item']")).toBeDisplayed();
    expect(await readFile(viewsPath, "utf8")).toBe("broken views file");
    await writeFile(viewsPath, JSON.stringify(file));
    await expect($("button[aria-label='Save as view']")).toBeEnabled();
    await $("[role='alert']").waitForExist({ reverse: true });
    await $("button[aria-label='Manage views']").click();
    await expect($$("[role='dialog'] button")).toBeElementsArrayOfSize(7);
    await browser.keys("Escape");
    await $("[role='dialog']").waitForExist({ reverse: true });
  });
});
