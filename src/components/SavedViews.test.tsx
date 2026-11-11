import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { PropertyDefinition, SavedWorkView, TaskQuery } from "../types";
import { SavedViews } from "./SavedViews";

const query: TaskQuery = { search: "", filters: [], sorts: [], folderPath: null, archived: false };
const saved: SavedWorkView = { id: "saved", name: "Focus", filters: [], sorts: [], folderPath: "project/child", archived: true };
const folders = [false, true].flatMap((archived) => [{ path: "project", archived }, { path: "project/child", archived }]);

function Harness({ path = "/a", definitions = [], initial = query, initialId = null }: { path?: string; definitions?: PropertyDefinition[]; initial?: TaskQuery; initialId?: string | null }) {
  const [current, setCurrent] = useState(initial);
  const [id, setId] = useState<string | null>(initialId);
  return <>
    <SavedViews workspacePath={path} query={current} activeId={id} onActiveIdChange={setId} onApply={(next) => setCurrent({ ...current, ...next })} definitions={definitions} folders={folders} />
    <button onClick={() => setCurrent({ ...current, archived: !current.archived })}>Change scope</button>
    <output data-testid="query">{JSON.stringify(current)}</output>
  </>;
}

async function saveAs(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Save as view" }));
  const dialog = screen.getByRole("dialog", { name: "Save as view" });
  fireEvent.change(within(dialog).getByLabelText("View name"), { target: { value: name } });
  fireEvent.submit(within(dialog).getByRole("button", { name: "Save changes" }).closest("form")!);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

it("creates, modifies, restores, updates and saves a copy", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save as view" })).toBeEnabled());
  await saveAs("  Focus  ");
  expect(screen.getByLabelText("Work views")).toHaveTextContent("Focus");
  fireEvent.click(screen.getByText("Change scope"));
  expect(screen.getByLabelText("Work views")).toHaveTextContent("Modified");
  fireEvent.click(screen.getByRole("button", { name: "Restore saved conditions" }));
  expect(screen.getByLabelText("Work views")).not.toHaveTextContent("Modified");
  fireEvent.click(screen.getByText("Change scope"));
  fireEvent.click(screen.getByRole("button", { name: "Update current view" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Update current view" })).not.toBeInTheDocument());
  expect((await api.loadViews("/a")).views[0].archived).toBe(true);
  await saveAs("Copy");
  expect((await api.loadViews("/a")).views.map((view) => view.name)).toEqual(["Focus", "Copy"]);
  await user.click(screen.getByLabelText("Work views"));
  await user.click(await screen.findByRole("option", { name: "Focus" }));
  expect(screen.getByLabelText("Work views")).toHaveTextContent("Focus");
});

it("validates trimmed names, renames and confirms deletion of configuration only", async () => {
  await api.saveViews("/a", [saved, { ...saved, id: "other", name: "Other" }], null);
  render(<Harness initialId={saved.id} initial={{ ...query, ...saved }} />);
  await waitFor(() => expect(screen.getByLabelText("Work views")).toHaveTextContent("Focus"));
  fireEvent.click(screen.getByRole("button", { name: "Manage views" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename view: Focus" }));
  const rename = screen.getByRole("dialog", { name: "Rename view" });
  const input = within(rename).getByLabelText("View name");
  fireEvent.change(input, { target: { value: "  " } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a view name");
  fireEvent.change(input, { target: { value: " Other " } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("already exists");
  fireEvent.change(input, { target: { value: "  Renamed  " } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByRole("dialog", { name: "Manage views" });
  fireEvent.click(screen.getByRole("button", { name: "Delete view: Renamed" }));
  expect(screen.getByRole("dialog", { name: "Delete view" })).toHaveTextContent("Only the view configuration");
  expect((await api.loadViews("/a")).views).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete view: Renamed" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByRole("dialog", { name: "Manage views" });
  expect((await api.loadViews("/a")).views.map((view) => view.name)).toEqual(["Other"]);
  expect(screen.getByTestId("query")).toHaveTextContent('"folderPath":"project/child"');
});

it("blocks invalid references and lets current valid conditions replace the saved view", async () => {
  const user = userEvent.setup();
  await api.saveViews("/a", [{ ...saved, folderPath: "missing" }], null);
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("Work views")).toBeEnabled());
  await user.click(screen.getByLabelText("Work views"));
  await user.click(await screen.findByRole("option", { name: "Focus" }));
  expect(screen.getByRole("alert")).toHaveTextContent("missing");
  expect(screen.getByTestId("query")).toHaveTextContent('"folderPath":null');
  fireEvent.click(screen.getByRole("button", { name: "Manage views" }));
  fireEvent.click(screen.getByRole("button", { name: "Use current conditions: Focus" }));
  await waitFor(() => expect(screen.getByLabelText("Work views")).toHaveTextContent("Focus"));
  expect((await api.loadViews("/a")).views[0].folderPath).toBeNull();
});

it("keeps the query and reloads on conflicts, and shows failed writes without success", async () => {
  const initial = await api.saveViews("/a", [saved], null);
  render(<Harness initialId={saved.id} initial={{ ...query, ...saved }} />);
  await waitFor(() => expect(screen.getByLabelText("Work views")).toHaveTextContent("Focus"));
  fireEvent.click(screen.getByText("Change scope"));
  await api.saveViews("/a", [{ ...saved, name: "External" }], initial.contentHash);
  fireEvent.click(screen.getByRole("button", { name: "Update current view" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("changed on disk"));
  expect(screen.getByLabelText("Work views")).toHaveTextContent("External · Modified");
  expect(screen.getByTestId("query")).toHaveTextContent('"archived":false');
  vi.spyOn(api, "saveViews").mockRejectedValue(new Error("disk full"));
  fireEvent.click(screen.getByRole("button", { name: "Update current view" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("disk full"));
  expect(screen.getByLabelText("Work views")).toHaveTextContent("Modified");
  expect((await api.loadViews("/a")).views[0].archived).toBe(true);
});

it("reloads external file signals while preserving modified conditions and guards corrupt files", async () => {
  let changed = () => {};
  vi.spyOn(api, "onViewsFileChange").mockImplementation(async (_path, callback) => { changed = callback; return () => {}; });
  const initial = await api.saveViews("/a", [saved], null);
  render(<Harness initialId={saved.id} initial={{ ...query, ...saved }} />);
  await waitFor(() => expect(screen.getByLabelText("Work views")).toHaveTextContent("Focus"));
  fireEvent.click(screen.getByText("Change scope"));
  await api.saveViews("/a", [{ ...saved, name: "Synced" }], initial.contentHash);
  await act(async () => changed());
  expect(screen.getByLabelText("Work views")).toHaveTextContent("Synced · Modified");
  localStorage.setItem("taskmate-browser-demo:views:/a", "broken");
  await act(async () => changed());
  expect(screen.getByRole("button", { name: "Update current view" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/JSON|Unexpected/);
  localStorage.setItem("taskmate-browser-demo:views:/a", JSON.stringify({ version: 1, views: [{ ...saved, name: "Repaired" }] }));
  await act(async () => changed());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Update current view" })).toBeEnabled();
});

it("supports keyboard selection and Escape, and constrains long names", async () => {
  const user = userEvent.setup();
  const name = "Long view name ".repeat(20);
  await api.saveViews("/a", [{ ...saved, name: name.trim() }], null);
  render(<Harness />);
  const trigger = screen.getByRole("combobox", { name: "Work views" });
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  await user.keyboard("{ArrowDown}{End}{Enter}");
  await waitFor(() => expect(trigger).toHaveTextContent(name.trim()));
  expect(within(trigger).getByTitle(name.trim())).toHaveClass("truncate");
  await user.click(screen.getByRole("button", { name: "Manage views" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Manage views" })).toHaveFocus();
});
