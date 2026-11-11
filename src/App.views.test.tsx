import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";
import { loadWorkViewState, saveWorkViewState } from "./lib/saved-views";
import type { SavedWorkView } from "./types";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({ measure: vi.fn(), measureElement: vi.fn(), scrollToIndex: vi.fn(), getTotalSize: () => options.count * 100, getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, key: index, start: index * 100 })) }),
}));
vi.mock("./components/MarkdownEditor", () => ({ MarkdownEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Draft body" value={value} onChange={(event) => onChange(event.target.value)} /> }));

const view: SavedWorkView = { id: "nested-archive", name: "Nested archive", archived: true, folderPath: "project/child", filters: [{ key: "status", operator: "eq", value: "done" }], sorts: [{ key: "priority", direction: "desc", nulls: "last" }, { key: "updatedAt", direction: "asc", nulls: "last" }] };

async function setup() {
  await api.openWorkspace("/views");
  const current = await api.createTask("Current task");
  await api.createFolder(false, "", "project");
  await api.createFolder(false, "project", "child");
  const archived = await api.createTask("Archived nested", "project/child");
  await api.saveTask({ ...archived, archived: true, properties: { ...archived.properties, status: "done" } });
  await api.saveViews("/views", [view], null);
  localStorage.setItem("taskmate-workspaces.v1", '["/views"]');
  return current;
}

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); window.location.hash = "#/";
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

it("applies complete queries, expands ancestors, clears checks and preserves the current draft", async () => {
  const user = userEvent.setup();
  const current = await setup();
  render(<App />);
  await screen.findByRole("checkbox", { name: "Select Current task" });
  const editor = await screen.findByLabelText("Draft body");
  fireEvent.change(editor, { target: { value: "Unsaved body survives view changes" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Current task" }));
  await user.click(screen.getByRole("button", { name: "Work views" }));
  await user.click(await screen.findByRole("menuitemcheckbox", { name: "Nested archive" }));
  await screen.findByRole("checkbox", { name: "Select Archived nested" });
  expect(screen.queryByRole("checkbox", { name: "Select Current task" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select Archived nested" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "child" })).toBeInTheDocument();
  expect(screen.getByLabelText("Task title")).toHaveValue("Current task");
  expect(editor).toHaveValue("Unsaved body survives view changes");
  expect(loadWorkViewState("/views")).toEqual({ query: { filters: view.filters, sorts: view.sorts, folderPath: view.folderPath, archived: true }, viewId: view.id });
  await waitFor(async () => expect((await api.getTask(current.id)).body).toBe("Unsaved body survives view changes"));
});

it("restores modified associated queries after restart and keeps workspace preferences isolated", async () => {
  await setup();
  saveWorkViewState("/views", { ...view, search: "", folderPath: null }, view.id);
  let app = render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Work views" })).toHaveTextContent("Nested archive · Modified"));
  await screen.findByRole("checkbox", { name: "Select Archived nested" });
  app.unmount();
  await api.openWorkspace("/other");
  await api.createTask("Other workspace");
  localStorage.setItem("taskmate-workspaces.v1", '["/other","/views"]');
  app = render(<App />);
  await screen.findByRole("checkbox", { name: "Select Other workspace" });
  expect(screen.getByRole("button", { name: "Work views" })).toHaveTextContent("All tasks");
  app.unmount();
  localStorage.setItem("taskmate-workspaces.v1", '["/views","/other"]');
  render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Work views" })).toHaveTextContent("Nested archive · Modified"));
  expect(screen.getByRole("button", { name: "Return to current tasks" })).toBeInTheDocument();
  expect(loadWorkViewState("/other")?.viewId).toBeNull();
});

it("continues with legacy filter, sort and folder preferences when the views file is corrupt", async () => {
  await setup();
  localStorage.setItem("taskmate-filter-sort.v1", JSON.stringify({ "/views": { filters: [{ key: "status", operator: "eq", value: "not-started" }], sort: { key: "title", direction: "asc", nulls: "last" } } }));
  localStorage.setItem("taskmate-folders.v1:/views:false", JSON.stringify({ selected: "", expanded: [] }));
  localStorage.setItem("taskmate-browser-demo:views:/views", "broken");
  render(<App />);
  await screen.findByRole("checkbox", { name: "Select Current task" });
  await userEvent.click(screen.getByRole("button", { name: "Work views" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("menuitem", { name: "Save as view" })).toHaveAttribute("data-disabled");
  expect(loadWorkViewState("/views")?.query).toMatchObject({ folderPath: "", sorts: [{ key: "title", direction: "asc", nulls: "last" }] });
  expect(localStorage.getItem("taskmate-browser-demo:views:/views")).toBe("broken");
});

it("refreshes relative conditions each minute and when the application regains focus", async () => {
  await setup();
  saveWorkViewState("/views", { search: "", archived: false, folderPath: null, filters: [{ key: "updatedAt", operator: "withinLastDays", value: 7 }], sorts: [] }, null);
  const interval = vi.spyOn(window, "setInterval");
  const queryTasks = vi.spyOn(api, "queryTasks");
  render(<App />);
  await screen.findByRole("checkbox", { name: "Select Current task" });
  const minute = interval.mock.calls.find((call) => call[1] === 60_000)![0] as () => void;
  const count = queryTasks.mock.calls.length;
  await act(async () => minute());
  expect(queryTasks.mock.calls.length).toBeGreaterThan(count);
  const nextCount = queryTasks.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(queryTasks.mock.calls.length).toBeGreaterThan(nextCount);
});
