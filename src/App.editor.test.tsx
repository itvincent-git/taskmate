import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";
import type { Task } from "./types";

async function openEditor() {
  const path = "/tmp/taskmate-editor-tests";
  await api.openWorkspace(path);
  const task = await api.createTask("First");
  await api.saveTask({ ...task, body: "initial" });
  localStorage.setItem("taskmate-workspaces.v1", JSON.stringify([path]));
  const result = render(<App />);
  await waitFor(() => expect(result.container.querySelector(".cm-editor")).not.toBeNull(), { timeout: 5_000 });
  const view = EditorView.findFromDOM(result.container.querySelector<HTMLElement>(".cm-editor")!)!;
  return { ...result, view, task };
}
function append(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text }, selection: { anchor: view.state.doc.length + text.length } }));
}
function pauseSave() {
  const original = api.saveTask.bind(api);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const save = vi.spyOn(api, "saveTask").mockImplementationOnce(async (task) => { await gate; return original(task); });
  return { save, release };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.location.hash = "#/";
});

describe("editor persistence", () => {
  it("does not replace the document when saving starts or acknowledges an older version", async () => {
    const { view, task } = await openEditor();
    const { save, release } = pauseSave();
    append(view, " first");
    const snapshot = view.state.doc;
    await waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(view.state.doc).toBe(snapshot);
    append(view, " second");
    const latest = view.state.doc;
    await act(async () => release());
    expect(view.state.doc).toBe(latest);
    expect(view.state.doc.toString()).toBe("initial first second");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(async () => expect((await api.getTask(task.id)).body).toBe("initial first second"));
  });

  it("manual save reads the latest document without waiting for autosave", async () => {
    const { view, task } = await openEditor();
    const save = vi.spyOn(api, "saveTask");
    append(view, " manual");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((await api.getTask(task.id)).body).toBe("initial manual");
  });

  it("replaces the document only when the external file is explicitly reloaded", async () => {
    let report!: (task: Task | null) => void;
    vi.spyOn(api, "checkExternalChange").mockImplementation(() => new Promise((resolve) => { report = resolve; }));
    const { view, task } = await openEditor();
    await waitFor(() => expect(report).toBeDefined());
    append(view, " local");
    await act(async () => report({ ...task, body: "external", contentHash: "external-hash" }));
    expect(within(screen.getByRole("dialog")).getByText("initial local")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload file" }));
    await waitFor(() => expect(view.state.doc.toString()).toBe("external"));
    const save = vi.spyOn(api, "saveTask");
    append(view, " new edit");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: "external new edit", contentHash: "external-hash" })));
  });

  it("waits for 650ms of inactivity instead of saving during continuous edits", async () => {
    const { view } = await openEditor();
    const save = vi.spyOn(api, "saveTask");
    for (let index = 0; index < 4; index++) {
      append(view, " text");
      await act(() => new Promise((resolve) => setTimeout(resolve, 220)));
      expect(save).not.toHaveBeenCalled();
    }
    await waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 1500 });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: "initial text text text text" }));
  });

  it("preserves a failed draft and keeps its tab open, then retries the latest text", async () => {
    const { view, task } = await openEditor();
    const original = api.saveTask.bind(api);
    const save = vi.spyOn(api, "saveTask").mockRejectedValue(new Error("disk full"));
    append(view, " unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Close tab: First" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.getByRole("tab")).toBeInTheDocument();
    expect(view.state.doc.toString()).toBe("initial unsaved");
    append(view, " retry");
    save.mockImplementation(original);
    fireEvent.click(screen.getByRole("button", { name: "Close tab: First" }));
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    expect((await api.getTask(task.id)).body).toBe("initial unsaved retry");
  });

  it("flushes the current document before creating another task", async () => {
    const { view, task } = await openEditor();
    append(view, " immediately");
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect((await api.getTask(task.id)).body).toBe("initial immediately");
    fireEvent.click(within(screen.getAllByRole("tab")[0]).getByRole("button", { name: "First" }));
    await waitFor(() => expect(document.querySelector(".cm-content")).toHaveTextContent("initial immediately"));
  });

  it("waits for an in-flight save and saves newer input before closing", async () => {
    const { view, task } = await openEditor();
    const { save, release } = pauseSave();
    append(view, " first");
    await waitFor(() => expect(save).toHaveBeenCalledOnce(), { timeout: 2000 });
    append(view, " newer");
    fireEvent.click(screen.getByRole("button", { name: "Close tab: First" }));
    expect(screen.getByRole("tab")).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    expect((await api.getTask(task.id)).body).toBe("initial first newer");
  });

  it("does not overwrite input when a previously started external check returns", async () => {
    let report!: (task: Task | null) => void;
    vi.spyOn(api, "checkExternalChange").mockImplementation(() => new Promise((resolve) => { report = resolve; }));
    const { view, task } = await openEditor();
    await waitFor(() => expect(report).toBeDefined());
    append(view, " local");
    await act(async () => report({ ...task, body: "external", contentHash: "external-hash" }));
    expect(view.state.doc.toString()).toBe("initial local");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
