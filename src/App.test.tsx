import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";

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

    expect(await screen.findByText("picker unavailable")).toHaveClass("banner", "error");
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
    expect(newTaskButton).toHaveClass("ui-button-default", "ui-button-icon");
    expect(newTaskButton).not.toHaveTextContent("New task");
    await user.click(newTaskButton);
    expect(await within(listToolbar).findByLabelText("Tasks: 1")).toHaveTextContent("1");
    const title = await screen.findByLabelText("Task title");
    expect(title).toHaveValue("Untitled task");
    await user.clear(title);
    await user.type(title, "Release checklist");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 2500 });

    const stored = localStorage.getItem("taskmate-browser-demo");
    expect(stored).toContain("Release checklist");
    expect(stored).toContain("not-started");
  });

  it("renders dynamic filters and field visibility settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(await screen.findByLabelText("Status Filter")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Properties" }));
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Status" })).toBeDisabled();
    expect(screen.getByLabelText("Priority type")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("switches the complete Taskmate shell to Simplified Chinese", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText("Language"));
    await user.click(await screen.findByRole("option", { name: "简体中文" }));
    expect(screen.getByRole("button", { name: "打开工作区" })).toBeInTheDocument();
    expect(screen.getByText("本地优先的任务管理")).toBeInTheDocument();
    expect(localStorage.getItem("taskmate.locale.v1")).toBe("zh-CN");
  });

  it("shows a failed autosave state instead of pretending an edit persisted", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    const failure = vi.spyOn(api, "saveTask").mockRejectedValueOnce(new Error("disk full"));
    await user.type(await screen.findByLabelText("Task title"), " changed");
    expect(await screen.findByText("Save failed", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("disk full");
    failure.mockRestore();
  });

  it("remembers workspaces and offers switching without retyping", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.clear(screen.getByLabelText("Workspace folder"));
    await user.type(screen.getByLabelText("Workspace folder"), "/tmp/remembered");
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(await screen.findByRole("toolbar", { name: "Task list" })).toBeInTheDocument();
    expect(localStorage.getItem("taskmate-workspaces.v1")).toContain("/tmp/remembered");

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(screen.getByRole("button", { name: /\/tmp\/remembered/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace folder")).toHaveValue("/tmp/remembered");
  });

  it("opens Markdown tasks in tabs and persists card display controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));
    await user.click(screen.getByRole("button", { name: "New task" }));
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0].closest("header")).toHaveAttribute("data-tauri-drag-region", "deep");

    await user.click(within(tabs[0]).getByRole("button", { name: "Untitled task" }));
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await user.click(within(tabs[1]).getByRole("button", { name: "Close tab: Untitled task" }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Compact cards" }));
    expect(localStorage.getItem("taskmate-compact-cards.v1")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Hide task cards" }));
    expect(localStorage.getItem("taskmate-task-list-visible.v1")).toBe("false");
    expect(screen.getByRole("button", { name: "Show task cards" })).toBeInTheDocument();
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
    const splitter = container.querySelector(".splitter") as HTMLElement;

    fireEvent(splitter, Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 390 }), { pointerId: 1 }));
    expect(document.body.style.userSelect).toBe("none");
    fireEvent(window, new MouseEvent("pointermove", { clientX: 510 }));
    fireEvent(window, new MouseEvent("pointerup"));

    expect(document.body.style.userSelect).toBe("");
    expect(localStorage.getItem("taskmate-task-list-width.v1")).toBe("510");
    expect(container.querySelector(".split-layout")).toHaveStyle({ gridTemplateColumns: "510px 5px minmax(0, 1fr)" });

    unmount();
    const restored = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(restored.container.querySelector(".split-layout")).toHaveStyle({ gridTemplateColumns: "510px 5px minmax(0, 1fr)" });
  });

  it("switches between current and archived tasks from the list toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    const toolbar = await screen.findByRole("toolbar", { name: "Task list" });
    const archiveButton = within(toolbar).getByRole("button", { name: "Archive" });

    expect(archiveButton).not.toHaveClass("active");
    await user.click(archiveButton);

    const returnButton = within(toolbar).getByRole("button", { name: "Return to current tasks" });
    expect(returnButton).toHaveClass("active");
    await user.click(returnButton);
    expect(within(toolbar).getByRole("button", { name: "Archive" })).not.toHaveClass("active");
  });

  it("shows one fixed property sidebar when the task detail is wide", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open task properties" })).not.toBeInTheDocument();
  });

  it("opens narrow task properties in a drawer, autosaves edits, and returns focus on Escape", async () => {
    detailWidth = 700;
    const user = userEvent.setup();
    const saveTask = vi.spyOn(api, "saveTask");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    await user.click(await screen.findByRole("button", { name: "New task" }));

    const openProperties = await screen.findByRole("button", { name: "Open task properties" });
    expect(screen.queryByRole("heading", { name: "Properties" })).not.toBeInTheDocument();
    await user.click(openProperties);

    const drawer = screen.getByRole("dialog", { name: "Properties" });
    expect(within(drawer).getByLabelText("Priority")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Priority")).toHaveLength(1);
    await user.click(within(drawer).getByLabelText("Priority"));
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

    await user.click(await screen.findByRole("button", { name: "Open task properties" }));
    expect(screen.getByRole("dialog", { name: "Properties" })).toBeInTheDocument();
    resizeDetail(800);
    expect(screen.queryByRole("dialog", { name: "Properties" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();

    resizeDetail(700);
    await user.click(await screen.findByRole("button", { name: "Open task properties" }));
    fireEvent.click(screen.getByRole("button", { name: "New task", hidden: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Properties" })).not.toBeInTheDocument());
  });
});
