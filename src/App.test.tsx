import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./lib/api";

describe("Taskmate application", () => {
  beforeEach(() => localStorage.clear());

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
    expect(await screen.findByLabelText("Filter by Status")).toBeInTheDocument();
    await user.click(screen.getByTitle("Properties"));
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Status" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
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
});
