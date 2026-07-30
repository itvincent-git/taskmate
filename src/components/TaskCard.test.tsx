import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition, TaskSummary } from "../types";
import { TaskCard } from "./TaskCard";

const status: PropertyDefinition = {
  id: "status",
  key: "status",
  name: "Status",
  type: "select",
  showInDetail: true,
  showInCard: true,
  enableFilter: true,
  enableSort: true,
  options: [{ id: "todo", label: "To do", color: "#718096", order: 0 }, { id: "done", label: "Done", color: "#22a06b", order: 1 }],
  order: 0,
};
const task: TaskSummary = {
  id: "task",
  title: "Card task",
  fileName: "Card task.md",
  archived: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  properties: { status: "todo" },
};

describe("TaskCard quick editing", () => {
  it("shows a single-line title with the full title available on hover and no file metadata", () => {
    const { container } = render(<TaskCard task={task} selected={false} definitions={[status]} onSelect={vi.fn()} onQuickEdit={vi.fn()} />);
    expect(screen.getByTitle("Card task")).toHaveClass("text-xs");
    expect(screen.getAllByText("To do").some((element) => element.classList.contains("text-xs"))).toBe(true);
    expect(screen.queryByText("Card task.md")).not.toBeInTheDocument();
    expect(container.querySelector("time")).not.toBeInTheDocument();
  });

  it("edits a property without selecting the card", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onQuickEdit = vi.fn();
    render(<TaskCard task={task} selected={false} definitions={[status]} onSelect={onSelect} onQuickEdit={onQuickEdit} />);
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Done" }));
    expect(onQuickEdit).toHaveBeenCalledWith("status", "done");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes the property editor with Escape or an outside click", async () => {
    const user = userEvent.setup();
    render(<TaskCard task={task} selected={false} definitions={[status]} onSelect={vi.fn()} onQuickEdit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });

  it("shows only the title in compact mode", () => {
    render(<TaskCard task={task} selected={false} definitions={[status]} compact onSelect={vi.fn()} onQuickEdit={vi.fn()} />);
    expect(screen.getByText("Card task")).toBeInTheDocument();
    expect(screen.queryByText("Card task.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Status" })).not.toBeInTheDocument();
  });
});
