import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";

describe("Taskmate application", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps manual workspace entry available and hides the native picker in browser mode", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("button", { name: "Choose folder" })).not.toBeInTheDocument();
    const input = screen.getByLabelText("Workspace folder");
    await user.clear(input);
    await user.type(input, "/tmp/manual{Enter}");

    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New task" }));
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
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeInTheDocument();
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
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Compact cards" }));
    expect(localStorage.getItem("taskmate-compact-cards.v1")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Hide task cards" }));
    expect(localStorage.getItem("taskmate-task-list-visible.v1")).toBe("false");
    expect(screen.getByRole("button", { name: "Show task cards" })).toBeInTheDocument();
  });
});
