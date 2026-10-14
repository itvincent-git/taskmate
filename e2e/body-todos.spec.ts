import { browser, expect, $, $$ } from "@wdio/globals";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspacePath: string;
let betaPath: string;
const frontmatter = (id: string, title: string, archived = false) => `---\nid: ${id}\ntitle: ${title}\narchived: ${archived}\ncreatedAt: 2026-09-15T00:00:00Z\nupdatedAt: 2026-09-15T00:00:00Z\nstatus: in-progress\n---\n\n`;
const panel = "section[aria-label='Body todos']";
const item = (text: string) => `${panel} input[aria-label='Complete todo: ${text}']`;

before(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), "taskmate-todos-e2e-"));
  await mkdir(join(workspacePath, "tasks", "Camel"), { recursive: true });
  await mkdir(join(workspacePath, "tasks", "Elelive"), { recursive: true });
  await mkdir(join(workspacePath, "archive", "Camel"), { recursive: true });
  await writeFile(join(workspacePath, "tasks", "Camel", "Alpha checklist.md"), frontmatter("alpha-todos", "Alpha checklist") + "# Sites\n## camel2.to\n- [ ] Configure login\n  Keep the explanation.\n  - [ ] Test mobile\n- [x] Previously shipped\n- [ ] ~~Cancelled request~~\n\n> - [ ] Quoted example\n\n```md\n- [ ] Code example\n```\n");
  betaPath = join(workspacePath, "tasks", "Elelive", "Beta checklist.md");
  await writeFile(betaPath, frontmatter("beta-todos", "Beta checklist") + "## Preview\n- [ ] Verify layout\n- [ ] Verify layout\n- [ ] Unique review\n");
  await writeFile(join(workspacePath, "tasks", "Camel", "MDX checklist.mdx"), frontmatter("mdx-todos", "MDX checklist") + "import Widget from './widget'\n\n<Widget>\n- [ ] JSX example\n</Widget>\n\n- [ ] MDX review\n");
  await writeFile(join(workspacePath, "archive", "Camel", "Old checklist.md"), frontmatter("old-todos", "Old checklist", true) + "- [ ] Archived remainder\n");
});

beforeEach(async () => {
  await writeFile(betaPath, frontmatter("beta-todos", "Beta checklist") + "## Preview\n- [ ] Verify layout\n- [ ] Verify layout\n- [ ] Unique review\n");
  await browser.execute(() => { localStorage.clear(); localStorage.setItem("taskmate.locale.v1", "en"); });
  await browser.refresh();
  await $("#workspace-path").waitForDisplayed();
  await $("#workspace-path").setValue(workspacePath);
  await $("//main/button").click();
  await $("button[aria-label='Body todos'], button[aria-label='正文待办']").waitForDisplayed();
  await $("button[aria-label='Body todos'], button[aria-label='正文待办']").click();
  await $(item("Configure login")).waitForDisplayed();
});

after(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe("Body todo summary in the native app", () => {
  it("groups real Markdown and MDX items, filters scope and excludes examples", async () => {
    await $(item("Configure login")).waitForDisplayed();
    await expect($(panel)).toHaveText(/Sites › camel2.to/);
    await expect($(panel)).toHaveText(/MDX review/);
    await expect($(panel)).not.toHaveText(/Cancelled request|Code example|JSX example|Previously shipped|Quoted example|Archived remainder/);
    await $("button[aria-label='Todo scope']").click();
    await $("//*[@role='option' and normalize-space(.)='Camel']").click();
    await browser.waitUntil(async () => !(await $(item("Unique review")).isExisting()));
    await expect($(item("Configure login"))).toBeDisplayed();
    await $("button[aria-label='Todo scope']").click();
    await $("//*[@role='option' and normalize-space(.)='Entire workspace']").click();
    await $(item("Unique review")).waitForDisplayed();
    await $("//label[contains(., 'Show completed')]/input").click();
    await $(item("Previously shipped")).waitForDisplayed();
    await expect($(item("Previously shipped"))).toBeSelected();
    await $("//label[contains(., 'Show completed')]/input").click();
    await $("//label[contains(., 'Include quoted lists')]/input").click();
    await $(item("Quoted example")).waitForDisplayed();
    await $("//label[contains(., 'Include quoted lists')]/input").click();
    await $("//label[contains(., 'Include archived')]/input").click();
    await $(item("Archived remainder")).waitForDisplayed();
    await $("//label[contains(., 'Include archived')]/input").click();
    await expect($(item("Archived remainder"))).not.toExist();
    await browser.saveScreenshot("/tmp/taskmate-body-todos.png");
  });

  it("locates the correct duplicate item and follows changed source positions", async () => {
    const original = await readFile(betaPath, "utf8");
    await writeFile(betaPath, original.replace("## Preview", "External introduction.\n\n## Preview"));
    await $(`${panel} button`).waitForExist();
    await $("//section[@aria-label='Body todos']//button[normalize-space(.)='Unique review']").click();
    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", "6");
    await $(`${panel} input[aria-label='Search todos']`).setValue("Verify layout");
    await browser.waitUntil(async () => {
      let count = 0;
      for (const button of await $$(`${panel} button`)) if (await button.getText() === "Verify layout") count++;
      return count === 2;
    });
    const duplicates = await $$(`${panel} button`);
    const targets = [];
    for (const button of duplicates) if (await button.getText() === "Verify layout") targets.push(button);
    expect(targets).toHaveLength(2);
    await targets[1].click();
    await $(".cm-editor").waitForDisplayed();
    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", "5");
    await expect($(`${panel} input[aria-label='Search todos']`)).toHaveValue("Verify layout");
    await expect($(".cm-todo-highlight")).toHaveText(/Verify layout/);
    await $(`${panel} input[aria-label='Search todos']`).setValue("");
  });

  it("checks a source item, saves draft text and reverses only the checked marker", async () => {
    const checkboxes = await $$(item("Verify layout"));
    expect(checkboxes).toHaveLength(2);
    await expect(checkboxes[0]).not.toBeSelected();
    await expect(checkboxes[1]).not.toBeSelected();
    await $("//section[@aria-label='Body todos']//button[normalize-space(.)='Unique review']").click();
    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", "4");
    // Reveal heading markers before typing at the start of the source line.
    await $("button[aria-label='Task actions']").click();
    await browser.keys("ArrowDown");
    await $("//*[@role='menuitemcheckbox' and normalize-space(.)='Source mode']").click();
    // The embedded driver uses HTMLElement.click(), which does not position
    // a contenteditable caret. Send the same mouse events as the editor tests.
    await browser.execute(() => {
      const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
        .find((candidate) => candidate.textContent?.includes("Preview"))!;
      const rect = line.getBoundingClientRect();
      const clientX = rect.left + 2;
      const clientY = rect.top + rect.height / 2;
      const target = document.elementFromPoint(clientX, clientY)!;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, detail: 1, clientX, clientY }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, buttons: 0, detail: 1, clientX, clientY }));
    });
    await browser.keys("Home");
    await expect($(".cm-editor")).toHaveAttribute("data-selection-line", "1");
    await expect($(".cm-editor")).toHaveAttribute("data-selection-column", "0");
    await $(".cm-content").addValue("Draft explanation.");
    await browser.keys("Enter");
    await browser.keys("Enter");
    await expect($(".cm-content")).toHaveText(/Draft explanation/);
    await $("button[aria-label='Task actions']").click();
    await browser.keys("ArrowDown");
    await $("//*[@role='menuitemcheckbox' and normalize-space(.)='Source mode']").click();
    await $(item("Unique review")).click();
    await browser.waitUntil(async () => (await readFile(betaPath, "utf8")).includes("[x] Unique review"));
    const saved = await readFile(betaPath, "utf8");
    expect(saved).toContain("Draft explanation.");
    expect(saved.match(/\[ \] Verify layout/g)).toHaveLength(2);
    await $(`${panel} [role='status'] button`).click();
    await browser.waitUntil(async () => (await readFile(betaPath, "utf8")).includes("[ ] Unique review"));
    const undone = await readFile(betaPath, "utf8");
    expect(undone).toContain("Draft explanation.");
    expect(undone).toContain("status: in-progress");
  });

  it("refreshes after external rename, move and archive", async () => {
    const content = await readFile(betaPath, "utf8");
    const destination = join(workspacePath, "archive", "Camel", "Renamed checklist.md");
    await writeFile(destination, content.replace("title: Beta checklist", "title: Renamed checklist").replace("archived: false", "archived: true"));
    await rm(betaPath);
    await browser.waitUntil(async () => !(await $(item("Unique review")).isExisting()));
    await $("//label[contains(., 'Include archived')]/input").click();
    await $(item("Unique review")).waitForDisplayed();
    await expect($(panel)).toHaveText(/Renamed checklist/);
    await expect($(panel)).toHaveText(/Camel · Archived/);
  });
});
