import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";
import type { GitStatus, TaskSearchResult } from "./types";

let detailWidth = 1000;
let resizeCallbacks: ResizeObserverCallback[] = [];

class ResizeObserverMock {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallbacks.push(callback);
  }

  observe(target: Element) {
    this.callback([{ target, contentRect: { width: detailWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  disconnect() {
    resizeCallbacks = resizeCallbacks.filter((callback) => callback !== this.callback);
  }

  unobserve() {}
}

function resizeDetail(width: number) {
  detailWidth = width;
  act(() => {
    resizeCallbacks.forEach((callback) => callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
  });
}

describe("Taskmate application", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.location.hash = "#/";
    detailWidth = 1000;
    resizeCallbacks = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("keeps manual workspace entry available and hides the native picker in browser mode", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("button", { name: "Choose folder" })).not.toBeInTheDocument();
    const input = screen.getByLabelText("Workspace folder");
    await user.clear(input);
    await user.type(input, "/tmp/manual{Enter}");

    expect(await screen.findByRole("toolbar", { name: "Task list" })).toBeInTheDocument();
  });

  it("shows the native picker when desktop support is available", () => {
    vi.spyOn(api, "supportsNativeFolderPicker").mockReturnValue(true);
    render(<App />);

    expect(screen.getByRole("button", { name: "Choose folder" })).toBeInTheDocument();
  });

  it("does not show the workspace screen while restoring a remembered workspace", async () => {
    localStorage.setItem("taskmate-workspaces.v1", JSON.stringify(["/tmp/remembered"]));
    let finishOpening: (() => void) | undefined;
    const opening = new Promise<Awaited<ReturnType<typeof api.openWorkspace>>>((resolve) => {
      finishOpening = () => resolve({ path: "/tmp/remembered", properties: [], tasks: [], indexRebuilt: false });
    });
    vi.spyOn(api, "openWorkspace").mockReturnValue(opening);

    render(<App />);

    expect(screen.queryByLabelText("Workspace folder")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument();

    finishOpening?.();
    expect(await screen.findByRole("toolbar", { name: "Task list" })).toBeInTheDocument();
  });

  it("opens a picked folder immediately and remembers it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "supportsNativeFolderPicker").mockReturnValue(true);
    vi.spyOn(api, "pickWorkspaceFolder").mockResolvedValue("/tmp/picked");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(await screen.findByRole("toolbar", { name: "Task list" })).toBeInTheDocument();
    expect(localStorage.getItem("taskmate-workspace")).toBe("/tmp/picked");
    expect(localStorage.getItem("taskmate-workspaces.v1")).toContain("/tmp/picked");
  });

  it("leaves the welcome page and current path unchanged when folder picking is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "supportsNativeFolderPicker").mockReturnValue(true);
    const picker = vi.spyOn(api, "pickWorkspaceFolder").mockResolvedValue(null);
    render(<App />);
    const input = screen.getByLabelText("Workspace folder");
    await user.clear(input);
    await user.type(input, "/tmp/unchanged");

    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(picker).toHaveBeenCalledWith("/tmp/unchanged");
    expect(input).toHaveValue("/tmp/unchanged");
    expect(screen.getByRole("heading", { name: "Taskmate" })).toBeInTheDocument();
    expect(localStorage.getItem("taskmate-workspace")).toBeNull();
  });

  it("shows the existing error banner when folder picking fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "supportsNativeFolderPicker").mockReturnValue(true);
    vi.spyOn(api, "pickWorkspaceFolder").mockRejectedValue(new Error("picker unavailable"));
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(await screen.findByText("picker unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Taskmate" })).toBeInTheDocument();
  });

  it("opens a workspace, creates a task, and persists edits", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "Taskmate" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Workspace folder"));
    await user.type(screen.getByLabelText("Workspace folder"), "/tmp/tasks");
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    const listToolbar = await screen.findByRole("toolbar", { name: "Task list" });
    expect(within(listToolbar).getByLabelText("Tasks: 0")).toHaveTextContent("0");

    const newTaskButton = within(listToolbar).getByRole("button", { name: "New task" });
    expect(newTaskButton).toBeEnabled();
    expect(newTaskButton).not.toHaveTextContent("New task");
    await user.click(newTaskButton);
    expect(await within(listToolbar).findByLabelText("Tasks: 1")).toHaveTextContent("1");
    const title = await screen.findByLabelText("Task title");
    expect(title).toHaveValue("Untitled task");
    await user.clear(title);
    await user.type(title, "Release checklist");
    await user.tab();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 2500 });

    const stored = localStorage.getItem("taskmate-browser-demo");
    expect(stored).toContain("Release checklist");
    expect(stored).toContain("not-started");

    await user.clear(title);
    await user.tab();
    await waitFor(() => expect(title).toHaveValue("Release checklist"), { timeout: 2500 });
    expect(localStorage.getItem("taskmate-browser-demo")).toContain("Release checklist");
  });

  it("keeps status in task properties while simplifying the editor header", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    const header = container.querySelector('[data-testid="detail-header"]');
    expect(header).not.toBeNull();
    expect(header).not.toHaveTextContent("Untitled task.md");
    expect(within(header as HTMLElement).queryByText("Untitled task.md")).not.toBeInTheDocument();
    expect(within(header as HTMLElement).queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("copies the current title and file path from the keyboard-accessible task menu", async () => {
    const user = userEvent.setup();
    const copyText = vi.spyOn(api, "copyText").mockResolvedValue();
    render(<App />);
    await user.clear(screen.getByLabelText("Workspace folder"));
    await user.type(screen.getByLabelText("Workspace folder"), "/tmp/workspace");
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await screen.findByRole("toolbar", { name: "Markdown formatting" });

    const trigger = screen.getByRole("button", { name: "Task actions" });
    await user.click(trigger);
    await user.keyboard("{End}{Enter}");
    expect(copyText).toHaveBeenLastCalledWith("/tmp/workspace/tasks/Untitled task.md");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const title = await screen.findByLabelText("Task title");
    fireEvent.change(title, { target: { value: "Latest title" } });
    fireEvent.blur(title);
    await user.click(trigger);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: "Archive task" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy title" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy file path" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Permanently delete" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Copy title" }));

    expect(copyText).toHaveBeenLastCalledWith("Latest title");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows copy failures through the existing error toast", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "copyText").mockRejectedValue(new Error("clipboard unavailable"));
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "Task actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy title" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("clipboard unavailable");
  });

  it("archives the current task from the task actions menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "Task actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive task" }));

    expect(await screen.findByRole("heading", { name: "Select a task" })).toBeInTheDocument();
    expect(localStorage.getItem("taskmate-browser-demo")).toContain('"archived":true');
  });

  it("localizes the task copy menu in Simplified Chinese", async () => {
    localStorage.setItem("taskmate.locale.v1", "zh-CN");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "打开工作区" }));
    await user.click(await screen.findByRole("button", { name: "新建任务" }));
    await user.click(screen.getByRole("button", { name: "任务操作" }));

    expect(screen.getByRole("menuitem", { name: "归档任务" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制标题" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制文件路径" })).toBeInTheDocument();
  });

  it("opens filters and sorting from the task list toolbar and applies changes immediately", async () => {
    const user = userEvent.setup();
    const queryTasks = vi.spyOn(api, "queryTasks");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    const toolbar = await screen.findByRole("toolbar", { name: "Task list" });
    const filterButton = within(toolbar).getByRole("button", { name: "Open filters and sorting" });

    expect(screen.queryByLabelText("Status Filter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();
    expect(filterButton).toHaveAttribute("aria-pressed", "false");

    await user.click(filterButton);
    const dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    expect(within(dialog).getByText("Changes apply immediately.", { exact: false })).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Status Filter"));
    await user.click(await screen.findByRole("option", { name: "Done" }));
    await waitFor(() => expect(queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: [{ key: "status", operator: "eq", value: "done" }],
    })));
    expect(filterButton).toHaveAttribute("aria-pressed", "true");

    await user.click(within(dialog).getByLabelText("Sort 1"));
    await user.click(await screen.findByRole("option", { name: "Status · Asc" }));
    await waitFor(() => expect(queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      sorts: [{ key: "status", direction: "asc", nulls: "last" }],
    })));
    await user.click(within(dialog).getByLabelText("Empty last"));
    await user.click(await screen.findByRole("option", { name: "Empty first" }));
    await waitFor(() => expect(queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      sorts: [{ key: "status", direction: "asc", nulls: "first" }],
    })));
    await user.click(within(dialog).getByRole("button", { name: "Add sort" }));
    await user.click(within(dialog).getByLabelText("Sort 2"));
    await user.click(await screen.findByRole("option", { name: "Priority · Desc" }));
    await waitFor(() => expect(queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      sorts: [
        { key: "status", direction: "asc", nulls: "first" },
        { key: "priority", direction: "desc", nulls: "last" },
      ],
    })));
    await user.click(within(dialog).getByRole("button", { name: "Move sort 2 up" }));
    await waitFor(() => expect(queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      sorts: [
        { key: "priority", direction: "desc", nulls: "last" },
        { key: "status", direction: "asc", nulls: "first" },
      ],
    })));
    expect(localStorage.getItem("taskmate-filter-sort.v1")).toContain('"operator":"eq"');
    expect(localStorage.getItem("taskmate-filter-sort.v1")).toContain('"nulls":"first"');

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filter & sort" })).not.toBeInTheDocument();
    await waitFor(() => expect(filterButton).toHaveFocus());
  });

  it("restores saved filters, sorting, and compact cards", async () => {
    localStorage.setItem("taskmate-workspaces.v1", JSON.stringify(["/tmp/remembered-view"]));
    localStorage.setItem("taskmate-filter-sort.v1", JSON.stringify({
      "/tmp/remembered-view": {
        filters: [{ key: "status", operator: "eq", value: "done" }],
        sort: { key: "status", direction: "desc", nulls: "first" },
      },
    }));
    localStorage.setItem("taskmate-compact-cards.v1", "true");
    const queryTasks = vi.spyOn(api, "queryTasks");
    const user = userEvent.setup();

    render(<App />);

    const toolbar = await screen.findByRole("toolbar", { name: "Task list" });
    expect(within(toolbar).getByRole("button", { name: "Comfortable cards" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(queryTasks).toHaveBeenLastCalledWith({
      search: "",
      archived: false,
      filters: [{ key: "status", operator: "eq", value: "done" }],
      sorts: [{ key: "status", direction: "desc", nulls: "first" }],
    }));

    await user.click(within(toolbar).getByRole("button", { name: "Open filters and sorting" }));
    const dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    expect(within(dialog).getByLabelText("Status Filter")).toHaveTextContent("Done");
    expect(within(dialog).getByLabelText("Sort 1")).toHaveTextContent("Status · Desc");
    expect(within(dialog).getByLabelText("Empty last")).toHaveTextContent("Empty first");
  });

  it("keeps field visibility settings on the properties page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await screen.findByRole("toolbar", { name: "Task list" });
    await user.click(screen.getByRole("link", { name: "Properties" }));
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Status" })).toBeDisabled();
    expect(screen.getByLabelText("Priority type")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("opens workspace pages as reusable, closable tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await screen.findByRole("toolbar", { name: "Task list" });

    await user.click(screen.getByRole("link", { name: "Properties" }));
    await user.click(screen.getByRole("link", { name: "Git backup" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("link", { name: "Properties" }));

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent("Properties");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await user.click(within(tabs[0]).getByRole("button", { name: "Close tab: Properties" }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Git & GitHub" })).toBeInTheDocument();
  });

  it("restores open tabs and the active tab when reopening the app", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("link", { name: "Properties" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Settings/ })).toHaveAttribute("aria-selected", "true");

    firstRender.unmount();
    render(<App />);

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    expect(screen.getByRole("tab", { name: /Properties/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Settings/ })).toHaveAttribute("aria-selected", "true");
  });

  it("lists the files currently modified in Git", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "gitStatus").mockResolvedValue({
      initialized: true,
      branch: "main",
      changes: [" M tasks/today.md", "?? tasks/new.md"],
      conflicts: [],
      ahead: 0,
      behind: 0,
    });
    vi.spyOn(api, "gitHistory").mockResolvedValue([]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(screen.getByRole("link", { name: "Git backup" }));

    const files = await screen.findByRole("list", { name: "Modified files" });
    expect(within(files).getByText("tasks/today.md")).toBeInTheDocument();
    expect(within(files).getByText("tasks/new.md")).toBeInTheDocument();
    expect(within(files).getByText("M")).toBeInTheDocument();
    expect(within(files).getByText("??")).toBeInTheDocument();
  });

  it("lists the files changed by recent commits", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "gitStatus").mockResolvedValue({
      initialized: true,
      branch: "main",
      changes: [],
      conflicts: [],
      ahead: 0,
      behind: 0,
    });
    vi.spyOn(api, "gitHistory").mockResolvedValue([{
      hash: "abc1234",
      date: "2026-08-20T10:00:00+08:00",
      subject: "feat: update tasks",
      files: ["tasks/today.md", "tasks/明日.md"],
    }]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(screen.getByRole("link", { name: "Git backup" }));

    const history = await screen.findByRole("list", { name: "Recent history" });
    expect(within(history).getByText("feat: update tasks")).toBeInTheDocument();
    expect(within(history).getByText("tasks/today.md")).toBeInTheDocument();
    expect(within(history).getByText("tasks/明日.md")).toBeInTheDocument();
  });

  it.each([
    { label: "Commit", progressLabel: "Committing…", command: "git_commit" },
    { label: "Pull", progressLabel: "Pulling…", command: "git_pull" },
    { label: "Push", progressLabel: "Pushing…", command: "git_push" },
  ])("shows progress and prevents repeated $label actions", async ({ label, progressLabel, command }) => {
    const user = userEvent.setup();
    const status: GitStatus = {
      initialized: true,
      branch: "main",
      changes: [" M tasks/today.md"],
      conflicts: [],
      ahead: 0,
      behind: 0,
    };
    let finishAction: ((value: GitStatus) => void) | undefined;
    const pendingAction = new Promise<GitStatus>((resolve) => { finishAction = resolve; });
    vi.spyOn(api, "gitStatus").mockResolvedValue(status);
    vi.spyOn(api, "gitHistory").mockResolvedValue([]);
    const gitAction = vi.spyOn(api, "gitAction").mockReturnValue(pendingAction);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(screen.getByRole("link", { name: "Git backup" }));

    await user.click(await screen.findByRole("button", { name: label }));

    const progressButton = screen.getByRole("button", { name: progressLabel });
    expect(progressButton).toBeDisabled();
    expect(progressButton).toHaveAttribute("aria-busy", "true");
    for (const buttonLabel of ["Commit", "Pull", "Push"]) {
      expect(screen.getByRole("button", { name: buttonLabel === label ? progressLabel : buttonLabel })).toBeDisabled();
    }
    await user.click(progressButton);
    expect(gitAction).toHaveBeenCalledTimes(1);
    expect(gitAction).toHaveBeenCalledWith(command, expect.any(Object));

    act(() => finishAction?.(status));
    await waitFor(() => expect(screen.getByRole("button", { name: label })).toBeEnabled());
  });

  it("shows one settings section at a time from the settings navigation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));

    const language = screen.getByRole("button", { name: "Language" });
    const fonts = screen.getByRole("button", { name: "Fonts" });
    const shortcuts = screen.getByRole("button", { name: "Keyboard shortcuts" });
    const updates = screen.getByRole("button", { name: "Software updates" });
    expect(language).toHaveAttribute("aria-pressed", "true");
    expect(fonts).toHaveAttribute("aria-pressed", "false");
    expect(shortcuts).toHaveAttribute("aria-pressed", "false");
    expect(updates).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Software updates" })).not.toBeInTheDocument();

    await user.click(fonts);
    expect(fonts).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Fonts" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();

    await user.click(shortcuts);
    expect(shortcuts).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Software updates" })).not.toBeInTheDocument();

    await user.click(updates);
    expect(updates).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Software updates" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();

    await user.click(language);
    expect(language).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Software updates" })).not.toBeInTheDocument();
  });

  it("switches the complete Taskmate shell to Simplified Chinese from settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await screen.findByRole("toolbar", { name: "Task list" });
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByLabelText("Language"));
    await user.click(await screen.findByRole("option", { name: "简体中文" }));
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "任务" })).toBeInTheDocument();
    expect(localStorage.getItem("taskmate.locale.v1")).toBe("zh-CN");
  });

  it("shows a failed save state instead of pretending a finished title edit persisted", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const failure = vi.spyOn(api, "saveTask").mockRejectedValueOnce(new Error("disk full"));
    await user.type(await screen.findByLabelText("Task title"), " changed");
    await user.tab();
    expect(await screen.findByText("Save failed", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("disk full");
    failure.mockRestore();
  });

  it("saves a title-derived filename only after title editing finishes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const saveTask = vi.spyOn(api, "saveTask");
    const title = await screen.findByLabelText("Task title");

    await user.clear(title);
    await user.type(title, "Draft filename");
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 750)));

    expect(saveTask).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(saveTask).toHaveBeenCalledOnce());
    expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft filename" }));
  });

  it("remembers workspaces and offers switching without retyping", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.clear(screen.getByLabelText("Workspace folder"));
    await user.type(screen.getByLabelText("Workspace folder"), "/tmp/remembered");
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(await screen.findByRole("toolbar", { name: "Task list" })).toBeInTheDocument();
    expect(localStorage.getItem("taskmate-workspaces.v1")).toContain("/tmp/remembered");
    expect(screen.queryByText("remembered")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Current workspace")).toBeInTheDocument();
    expect(screen.getByText("remembered")).toBeInTheDocument();
    expect(screen.getByTitle("/tmp/remembered")).toHaveTextContent("/tmp/remembered");

    await user.click(screen.getByRole("menuitem", { name: "Switch workspace" }));
    expect(screen.getByRole("button", { name: /\/tmp\/remembered/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace folder")).toHaveValue("/tmp/remembered");
    expect(localStorage.getItem("taskmate-workspaces.v1")).toContain("/tmp/remembered");
  });

  it("opens Markdown tasks in tabs and persists card display controls", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "New task" }));
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" }));
    expect(scrollIntoView.mock.instances.at(-1)).toBe(tabs[1]);
    expect(tabs[0].closest("header")).toHaveAttribute("data-tauri-drag-region", "deep");
    const tablist = screen.getByRole("tablist", { name: "Open Markdown files" });
    expect(tablist).toHaveClass("scrollbar-hidden", "overflow-x-auto", "overflow-y-hidden");
    expect(tabs[0]).toHaveClass("shrink-0", "select-none");
    const filesButton = screen.getByRole("button", { name: "Files" });
    const searchButton = screen.getByRole("button", { name: "Search" });
    const hideListButton = screen.getByRole("button", { name: "Collapse" });
    expect(filesButton).toHaveAttribute("aria-pressed", "true");
    expect(searchButton.compareDocumentPosition(hideListButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablist).not.toContainElement(hideListButton);
    expect(hideListButton.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Task list" })).not.toContainElement(hideListButton);

    await user.click(within(tabs[0]).getByRole("button", { name: "Untitled task" }));
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await user.click(within(tabs[1]).getByRole("button", { name: "Close tab: Untitled task" }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Compact cards" }));
    expect(localStorage.getItem("taskmate-compact-cards.v1")).toBe("true");
    await user.click(hideListButton);
    expect(localStorage.getItem("taskmate-task-list-visible.v1")).toBe("false");
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Properties" }));
    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
  });

  it("closes tabs from the tab context menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    for (let index = 0; index < 4; index += 1) await user.click(await screen.findByRole("button", { name: "New task" }));

    let tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Close" }));
    expect(screen.getAllByRole("tab")).toHaveLength(3);

    tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]);
    await user.click(await screen.findByRole("menuitem", { name: "Close tab after" }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "New task" }));
    tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]);
    await user.click(await screen.findByRole("menuitem", { name: "Close others" }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab")).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "New task" }));
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Close all" }));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a task" })).toBeInTheDocument();
  });

  it("offers current task actions for the tab that was right-clicked", async () => {
    const user = userEvent.setup();
    const copyText = vi.spyOn(api, "copyText").mockResolvedValue();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const title = await screen.findByLabelText("Task title");
    fireEvent.change(title, { target: { value: "Background task" } });
    fireEvent.blur(title);
    await user.click(screen.getByRole("button", { name: "New task" }));

    const backgroundTab = screen.getAllByRole("tab")[0];
    fireEvent.contextMenu(backgroundTab);
    expect(await screen.findByText("Task actions")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive task" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy file path" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Copy title" }));

    expect(copyText).toHaveBeenLastCalledWith("Background task");
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("persists and restores the side panel, search text, and collapsed state", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByLabelText("Search tasks…"), "remember me");
    await user.click(screen.getByRole("button", { name: "Collapse" }));

    expect(localStorage.getItem("taskmate-task-panel.v1")).toBe("search");
    expect(localStorage.getItem("taskmate-task-search.v1")).toBe("remember me");
    expect(localStorage.getItem("taskmate-task-list-visible.v1")).toBe("false");

    first.unmount();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Search tasks…")).toHaveValue("remember me");
  });

  it("debounces workspace search, skips blanks, and ignores stale responses", async () => {
    const user = userEvent.setup();
    let resolveFirst: ((value: TaskSearchResult[]) => void) | undefined;
    const searchTasks = vi.spyOn(api, "searchTasks")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([{ id: "new", title: "New result", archived: false, snippet: "new text" }]);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByLabelText("Search tasks…");
    await user.type(input, "   ");
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 300)));
    expect(searchTasks).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "old");
    expect(searchTasks).not.toHaveBeenCalled();
    await waitFor(() => expect(searchTasks).toHaveBeenCalledWith("old"));

    await user.clear(input);
    await user.type(input, "new");
    await waitFor(() => expect(searchTasks).toHaveBeenLastCalledWith("new"));
    resolveFirst?.([{ id: "old", title: "Old result", archived: false, snippet: "old text" }]);
    await act(async () => Promise.resolve());
    expect(screen.queryByText("Old result")).not.toBeInTheDocument();
  });

  it("does not save unchanged tasks when switching between different bodies", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "New task" }));
    const getTask = api.getTask.bind(api);
    vi.spyOn(api, "getTask").mockImplementation(async (id) => ({ ...await getTask(id), body: `Body for ${id}` }));
    const saveTask = vi.spyOn(api, "saveTask");
    const tabs = screen.getAllByRole("tab");

    await user.click(within(tabs[0]).getByRole("button", { name: "Untitled task" }));
    await user.click(within(tabs[1]).getByRole("button", { name: "Untitled task" }));
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 750)));

    expect(saveTask).not.toHaveBeenCalled();
  });

  it("saves a dirty task once before switching tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "New task" }));
    const tabs = screen.getAllByRole("tab");
    await user.click(within(tabs[0]).getByRole("button", { name: "Untitled task" }));
    const saveTask = vi.spyOn(api, "saveTask");

    await user.type(await screen.findByLabelText("Task title"), " changed");
    await user.click(within(tabs[1]).getByRole("button", { name: "Untitled task" }));

    expect(saveTask).toHaveBeenCalledOnce();
    expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Untitled task changed" }));
  });

  it("persists the resized task list width and prevents text selection while dragging", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await screen.findByRole("toolbar", { name: "Task list" });
    const splitter = container.querySelector('[data-testid="splitter"]') as HTMLElement;

    fireEvent(splitter, Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 390 }), { pointerId: 1 }));
    expect(document.body.style.userSelect).toBe("none");
    fireEvent(window, new MouseEvent("pointermove", { clientX: 510 }));
    fireEvent(window, new MouseEvent("pointerup"));

    expect(document.body.style.userSelect).toBe("");
    expect(localStorage.getItem("taskmate-task-list-width.v1")).toBe("510");
    expect(container.querySelector('[data-testid="split-layout"]')).toHaveStyle({ gridTemplateColumns: "510px 5px minmax(0, 1fr)" });

    unmount();
    const restored = render(<App />);
    await screen.findByRole("toolbar", { name: "Task list" });
    expect(restored.container.querySelector('[data-testid="split-layout"]')).toHaveStyle({ gridTemplateColumns: "510px 5px minmax(0, 1fr)" });
  });

  it("persists the resized task properties width", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const splitter = container.querySelector('[data-testid="properties-splitter"]') as HTMLElement;

    fireEvent(splitter, Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 680 }), { pointerId: 1 }));
    expect(document.body.style.userSelect).toBe("none");
    fireEvent(window, new MouseEvent("pointermove", { clientX: 580 }));
    fireEvent(window, new MouseEvent("pointerup"));

    expect(document.body.style.userSelect).toBe("");
    expect(localStorage.getItem("taskmate-task-properties-width.v1")).toBe("420");
    expect(container.querySelector('[data-testid="detail-split-layout"]')).toHaveStyle({ gridTemplateColumns: "minmax(0, 1fr) 5px 420px" });

    unmount();
    const restored = render(<App />);
    await user.click(await screen.findByRole("button", { name: "New task" }));
    expect(restored.container.querySelector('[data-testid="detail-split-layout"]')).toHaveStyle({ gridTemplateColumns: "minmax(0, 1fr) 5px 420px" });
  });

  it("switches between current and archived tasks from the list toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    const toolbar = await screen.findByRole("toolbar", { name: "Task list" });
    const archiveButton = within(toolbar).getByRole("button", { name: "Archive" });

    expect(archiveButton).toHaveAttribute("aria-pressed", "false");
    await user.click(archiveButton);

    const returnButton = within(toolbar).getByRole("button", { name: "Return to current tasks" });
    expect(returnButton).toHaveAttribute("aria-pressed", "true");
    await user.click(returnButton);
    expect(within(toolbar).getByRole("button", { name: "Archive" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles the wide task property sidebar from the right edge of the tab bar", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    const tablist = screen.getByRole("tablist", { name: "Open Markdown files" });
    const collapseProperties = screen.getByRole("button", { name: "Collapse task properties" });
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    expect(collapseProperties).toHaveAttribute("aria-expanded", "true");
    expect(tablist.compareDocumentPosition(collapseProperties) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(collapseProperties);
    expect(screen.queryByRole("heading", { name: "Properties" })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="detail-split-layout"]')).toHaveStyle({ gridTemplateColumns: "minmax(0, 1fr)" });

    await user.click(screen.getByRole("button", { name: "Expand task properties" }));
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
  });

  it("opens narrow task properties in a drawer, autosaves edits, and returns focus on Escape", async () => {
    detailWidth = 700;
    const user = userEvent.setup();
    const saveTask = vi.spyOn(api, "saveTask");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    const openProperties = await screen.findByRole("button", { name: "Expand task properties" });
    expect(screen.queryByRole("heading", { name: "Properties" })).not.toBeInTheDocument();
    await user.click(openProperties);

    const drawer = screen.getByRole("dialog", { name: "Properties" });
    expect(within(drawer).getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Priority")).toHaveLength(1);
    const priority = within(drawer).getByLabelText("Priority");
    await user.click(priority);
    await user.click(await screen.findByRole("option", { name: "High" }));
    await waitFor(() => {
      expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({
        properties: expect.objectContaining({ priority: "high" }),
      }));
    }, { timeout: 2500 });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Properties" })).not.toBeInTheDocument();
    await waitFor(() => expect(openProperties).toHaveFocus());
  });

  it("closes the property drawer when the breakpoint or selected task changes", async () => {
    detailWidth = 700;
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    await user.click(await screen.findByRole("button", { name: "Expand task properties" }));
    expect(screen.getByRole("dialog", { name: "Properties" })).toBeInTheDocument();
    resizeDetail(800);
    expect(screen.queryByRole("dialog", { name: "Properties" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();

    resizeDetail(700);
    await user.click(await screen.findByRole("button", { name: "Expand task properties" }));
    fireEvent.click(screen.getByRole("button", { name: "New task", hidden: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Properties" })).not.toBeInTheDocument());
  });

  it("remeasures the detail panel after returning from properties", async () => {
    detailWidth = 700;
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    expect(await screen.findByRole("button", { name: "Expand task properties" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Properties" }));
    detailWidth = 800;
    await user.click(screen.getByRole("link", { name: "Tasks" }));

    expect(await screen.findByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand task properties" })).not.toBeInTheDocument();
  });

  it("persists a new tag option before saving it on the task", async () => {
    const user = userEvent.setup();
    const createOption = vi.spyOn(api, "createPropertyOption").mockResolvedValue({ id: "Release, 1", label: "Release, 1", color: "#9C9C9C", order: 0 });
    const saveTask = vi.spyOn(api, "saveTask");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    await user.type(screen.getByRole("textbox", { name: "Tags" }), "  Release, 1  {Enter}");

    expect(createOption).toHaveBeenCalledWith(expect.any(String), "Release, 1");
    await waitFor(() => expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({ tags: ["Release, 1"] }),
    })), { timeout: 2500 });
    expect(createOption.mock.invocationCallOrder[0]).toBeLessThan(saveTask.mock.invocationCallOrder[0]);
  });

  it("keeps an unpersisted tag in the input and leaves the task unchanged", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "createPropertyOption").mockRejectedValue(new Error("tag persistence failed"));
    const saveTask = vi.spyOn(api, "saveTask");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const input = screen.getByRole("textbox", { name: "Tags" });

    await user.type(input, "Blocked tag{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("tag persistence failed");
    expect(input).toHaveValue("Blocked tag");
    expect(saveTask).not.toHaveBeenCalled();
  });
});
