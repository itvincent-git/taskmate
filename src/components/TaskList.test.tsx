import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition, TaskSummary } from "../types";
import { TaskList } from "./TaskList";

const virtualizerMock = vi.hoisted(() => {
  const measure = vi.fn();
  const measureElement = vi.fn();
  const virtualizer = {
    measure,
    measureElement,
    getTotalSize: () => 130,
    getVirtualItems: () => [{ index: 0, key: "task", start: 0, end: 130, size: 130, lane: 0 }],
  };
  return { options: vi.fn(), virtualizer };
});

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: unknown) => {
    virtualizerMock.options(options);
    return virtualizerMock.virtualizer;
  },
}));

const status: PropertyDefinition = {
  id: "status",
  key: "status",
  name: "Status",
  type: "select",
  showInDetail: true,
  showInCard: true,
  enableFilter: true,
  enableSort: true,
  options: [{ id: "todo", label: "To do", color: "#718096", order: 0 }],
  order: 0,
};

const task: TaskSummary = {
  id: "task",
  title: "Virtual task",
  fileName: "Virtual task.md",
  archived: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  properties: { status: "todo" },
};

describe("TaskList", () => {
  it("renders stable virtual row positions keyed by task id", () => {
    render(
      <TaskList
        tasks={[task]}
        definitions={[status]}
        selectedId="task"
        compact={false}
        emptyState={null}
        onSelect={vi.fn()}
        onQuickEdit={vi.fn()}
      />,
    );

    const options = virtualizerMock.options.mock.lastCall?.[0] as {
      overscan: number;
      getScrollElement(): Element | null;
      getItemKey(index: number): React.Key;
      estimateSize(): number;
    };
    const row = screen.getByText("Virtual task").closest("[data-index]");
    const sizeContainer = row?.parentElement;

    expect(options.overscan).toBe(6);
    expect(options.getItemKey(0)).toBe("task");
    expect(options.estimateSize()).toBe(130);
    expect(options.getScrollElement()).toBe(sizeContainer?.parentElement);
    expect(virtualizerMock.virtualizer.measureElement).toHaveBeenCalledWith(row);
    expect((sizeContainer as HTMLElement).style.height).toBe("130px");
    expect((row as HTMLElement).style.transform).toBe("translateY(0px)");
    expect(row).toHaveClass("pb-1");
    expect(sizeContainer?.parentElement).toHaveClass("px-2", "pb-2");
  });

  it("remeasures with the compact card estimate", () => {
    const { rerender } = render(
      <TaskList tasks={[task]} definitions={[status]} compact={false} emptyState={null} onSelect={vi.fn()} onQuickEdit={vi.fn()} />,
    );
    const initialMeasureCalls = virtualizerMock.virtualizer.measure.mock.calls.length;

    rerender(<TaskList tasks={[task]} definitions={[status]} compact emptyState={null} onSelect={vi.fn()} onQuickEdit={vi.fn()} />);

    const options = virtualizerMock.options.mock.lastCall?.[0] as { estimateSize(): number };
    expect(options.estimateSize()).toBe(48);
    expect(virtualizerMock.virtualizer.measure).toHaveBeenCalledTimes(initialMeasureCalls + 1);
  });
});
