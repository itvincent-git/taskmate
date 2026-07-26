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
  it("edits a property without selecting the card", async () => {
    const onSelect = vi.fn();
    const onQuickEdit = vi.fn();
    render(<TaskCard task={task} selected={false} definitions={[status]} onSelect={onSelect} onQuickEdit={onQuickEdit} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Status"), "done");
    expect(onQuickEdit).toHaveBeenCalledWith("status", "done");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
