import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";
import { TASK_DRAG_TYPE } from "./components/FolderNavigator";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({ measure: vi.fn(), measureElement: vi.fn(), scrollToIndex: vi.fn(), getTotalSize: () => options.count * 100, getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, key: index, start: index * 100 })) }),
}));
vi.mock("./components/MarkdownEditor", () => ({ MarkdownEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Test body" value={value} onChange={(e) => onChange(e.target.value)} /> }));

async function setup() {
  await api.openWorkspace("/tmp/folder-tests");
  await api.createFolder(false, "", "a");
  await api.createFolder(false, "a", "child");
  await api.createFolder(false, "", "target");
  const first = await api.createTask("Alpha", "a");
  const second = await api.createTask("Beta", "a/child");
  const third = await api.createTask("Gamma");
  localStorage.setItem("taskmate-workspaces.v1", JSON.stringify(["/tmp/folder-tests"]));
  localStorage.setItem("taskmate-filter-sort.v1", JSON.stringify({ "/tmp/folder-tests": { filters: [], sorts: [{ key: "title", direction: "asc", nulls: "last" }] } }));
  render(<App />);
  await screen.findByRole("checkbox", { name: "Select Alpha" });
  return { first, second, third };
}

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); window.location.hash = "#/";
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe("folder workflows", () => {
  it("selects a visible range independently of the editor and clears selection on navigation", async () => {
    await setup();
    const original = (screen.getByLabelText("Task title") as HTMLInputElement).value;
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.click(screen.getByText("Gamma", { selector: "article div" }), { shiftKey: true });
    expect(screen.getByRole("checkbox", { name: "Select Beta" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Gamma" })).toBeChecked();
    expect(screen.getByLabelText("Task title")).toHaveValue(original);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select Gamma" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Beta" })).toBeInTheDocument();
  });
  it("moves all results through the dialog and refreshes tab paths", async () => {
    const { first, second, third } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Select all results" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to · 3" }));
    const dialog = screen.getByRole("dialog", { name: "Move tasks" });
    fireEvent.change(within(dialog).getByLabelText("Destination folder"), { target: { value: "target" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Move (3)" }).closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    for (const task of [first, second, third]) expect((await api.getTask(task.id)).folderPath).toBe("target");
    const copy = vi.spyOn(api, "copyText").mockResolvedValue();
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy file path" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining("/tasks/target/")));
  });
  it("stops a drop when pending title saving fails", async () => {
    await setup();
    const currentTitle = (screen.getByLabelText("Task title") as HTMLInputElement).value;
    const current = (await api.queryTasks({ search: "", archived: false, filters: [], sorts: [] })).find((t) => t.title === currentTitle)!;
    const move = vi.spyOn(api, "moveTasks");
    vi.spyOn(api, "saveTask").mockRejectedValue(new Error("Disk is unavailable"));
    fireEvent.focus(screen.getByLabelText("Task title"));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Unsaved title" } });
    fireEvent.drop(screen.getByRole("button", { name: "target" }), { dataTransfer: { getData: (type: string) => type === TASK_DRAG_TYPE ? JSON.stringify({ archived: false, ids: [current.id] }) : "" } });
    await screen.findByText("Disk is unavailable");
    expect(move).not.toHaveBeenCalled();
    expect((await api.getTask(current.id)).folderPath).toBe(current.folderPath);
  });
  it("refreshes an external move without replacing the unsaved body", async () => {
    let changed = () => {};
    vi.spyOn(api, "onWorkspaceFileChange").mockImplementation(async (callback) => { changed = callback; return () => {}; });
    await setup();
    const query = await api.queryTasks({ search: "", archived: false, filters: [], sorts: [] });
    const currentTitle = (screen.getByLabelText("Task title") as HTMLInputElement).value;
    const current = query.find((t) => t.title === currentTitle)!;
    fireEvent.focus(screen.getByLabelText("Task title"));
    const editor = await screen.findByLabelText("Test body");
    fireEvent.change(editor, { target: { value: "Unsaved draft" } });
    await api.moveTasks([current.id], false, "target");
    act(changed);
    await waitFor(() => expect(localStorage.getItem("taskmate-recent-files.v1")).toContain('"folderPath":"target"'));
    expect(editor).toHaveValue("Unsaved draft");
  });
});
