import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";

// jsdom does not implement the geometry used by CodeMirror scrollIntoView.
Object.defineProperties(Range.prototype, {
  getClientRects: { configurable: true, value: () => [] },
  getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
});

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.location.hash = "#/";
});

async function setup(body = "# Release\n- [ ] Test mobile\n- [ ] ~~Cancelled~~\n\n```md\n- [ ] Example\n```\n") {
  const path = "/tmp/taskmate-todo-tests";
  await api.openWorkspace(path);
  const task = await api.createTask("Release notes");
  await api.saveTask({ ...task, body });
  localStorage.setItem("taskmate-workspaces.v1", JSON.stringify([path]));
  const result = render(<App />);
  await waitFor(() => expect(result.container.querySelector(".cm-editor")).not.toBeNull(), { timeout: 5000 });
  fireEvent.click(screen.getByRole("button", { name: "Body todos" }));
  const panel = await screen.findByRole("region", { name: "Body todos" });
  await within(panel).findByRole("checkbox", { name: "Complete todo: Test mobile" });
  const view = EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)!;
  return { task, panel, view, ...result };
}

describe("body todo workflow", () => {
  it("shows actionable source items and locates them after an unsaved insertion", async () => {
    const { panel, view } = await setup();
    expect(within(panel).queryByText("Cancelled")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Example")).not.toBeInTheDocument();
    act(() => view.dispatch({ changes: { from: 0, insert: "New context\n\n" } }));
    fireEvent.change(within(panel).getByRole("textbox", { name: "Search todos" }), { target: { value: "mobile" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Test mobile" }));
    await waitFor(() => expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("[ ]")));
    expect(within(panel).getByRole("textbox", { name: "Search todos" })).toHaveValue("mobile");
  });

  it("saves a summary check alongside the latest draft and undoes only that marker", async () => {
    const { panel, view, task } = await setup();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nKeep this new explanation.\n" } }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" }));
    await waitFor(async () => expect((await api.getTask(task.id)).body).toContain("[x] Test mobile"));
    expect((await api.getTask(task.id)).body).toContain("Keep this new explanation.");
    expect(view.state.doc.toString()).toContain("[x] Test mobile");
    fireEvent.click(await within(panel).findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await api.getTask(task.id)).body).toContain("[ ] Test mobile"));
    expect((await api.getTask(task.id)).body).toContain("Keep this new explanation.");
    expect((await api.getTask(task.id)).properties.status).toBe("not-started");
  });

  it("keeps failed checks visible as incomplete and retries the current draft", async () => {
    const { panel, task } = await setup();
    const original = api.saveTask.bind(api);
    const save = vi.spyOn(api, "saveTask").mockRejectedValue(new Error("disk full"));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" }));
    await within(panel).findByText("Not saved; retry or resolve the conflict", {}, { timeout: 5000 });
    expect(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" })).not.toBeChecked();
    expect(within(panel).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect((await api.getTask(task.id)).body).toContain("[ ] Test mobile");
    save.mockImplementation(original);
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" }));
    await waitFor(async () => expect((await api.getTask(task.id)).body).toContain("[x] Test mobile"));
    fireEvent.click(await within(panel).findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await api.getTask(task.id)).body).toContain("[ ] Test mobile"));
  });

  it("gives source-editor undo its own history entry without undoing recently typed notes", async () => {
    const { panel, task, view } = await setup();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nFresh notes.\n" }, userEvent: "input.type" }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" }));
    await waitFor(async () => expect((await api.getTask(task.id)).body).toContain("[x] Test mobile"));
    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.toString()).toContain("[ ] Test mobile");
    expect(view.state.doc.toString()).toContain("Fresh notes.");
  });

  it("protects the external version and draft when checking encounters a file conflict", async () => {
    const { panel, task, view } = await setup();
    vi.spyOn(api, "saveTask").mockRejectedValue(new Error("EXTERNAL_CHANGE: External edit"));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" }));
    await screen.findByRole("dialog");
    expect((await api.getTask(task.id)).body).toContain("[ ] Test mobile");
    expect(view.state.doc.toString()).toContain("[x] Test mobile");
    expect(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile", hidden: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload file" }));
    await waitFor(() => expect(view.state.doc.toString()).toContain("[ ] Test mobile"));
    expect(within(panel).getByRole("checkbox", { name: "Complete todo: Test mobile" })).not.toBeChecked();
  });
});
