import { fireEvent, render, screen } from "@testing-library/react";
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
const tags: PropertyDefinition = { ...status, id: "tags", key: "tags", name: "Tags", type: "tags", options: [] };
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
    expect(screen.getByTitle("Card task")).toHaveClass("text-sm", "font-semibold");
    expect(container.querySelector("article")).toHaveClass("p-3");
    expect(screen.getAllByText("To do").some((element) => element.classList.contains("text-xs"))).toBe(true);
    expect(screen.queryByText("Card task.md")).not.toBeInTheDocument();
    expect(container.querySelector("time")).not.toBeInTheDocument();
  });

  it("edits a property without selecting the card", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onQuickEdit = vi.fn();
    render(<TaskCard task={task} selected={false} definitions={[status]} onSelect={onSelect} onQuickEdit={onQuickEdit} />);
    await user.hover(screen.getAllByText("To do")[0]);
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Done" }));
    expect(onQuickEdit).toHaveBeenCalledWith("status", "done");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the property editor positioned inside the card", () => {
    const { container } = render(<TaskCard task={task} selected={false} definitions={[status]} onSelect={vi.fn()} onQuickEdit={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveClass("max-w-40");
    expect(container.querySelector(".group.relative")).toContainElement(screen.getByRole("combobox", { name: "Status" }));
  });

  it("creates a tag option before quick editing the card", async () => {
    const user = userEvent.setup();
    const onCreateOption = vi.fn().mockResolvedValue({ id: "Card tag", label: "Card tag", color: "#9C9C9C", order: 0 });
    const onQuickEdit = vi.fn();
    render(<TaskCard task={{ ...task, properties: { tags: [] } }} selected={false} definitions={[tags]} onSelect={vi.fn()} onQuickEdit={onQuickEdit} onCreateOption={onCreateOption} />);

    await user.type(screen.getByRole("textbox", { name: "Tags" }), "Card tag{Enter}");

    expect(onCreateOption).toHaveBeenCalledWith(tags, "Card tag");
    expect(onQuickEdit).toHaveBeenCalledWith("tags", ["Card tag"]);
    expect(onCreateOption.mock.invocationCallOrder[0]).toBeLessThan(onQuickEdit.mock.invocationCallOrder[0]);
  });

  it("shows only the title in compact mode", () => {
    render(<TaskCard task={task} selected={false} definitions={[status]} compact onSelect={vi.fn()} onQuickEdit={vi.fn()} />);
    expect(screen.getByText("Card task")).toBeInTheDocument();
    expect(screen.queryByText("Card task.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });
});
