import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition, TaskSummary } from "../types";
import { TaskList } from "./TaskList";

const virtualizerMock = vi.hoisted(() => {
  const containerRef = vi.fn();
  const measure = vi.fn();
  const measureElement = vi.fn();
  const virtualizer = {
    containerRef,
    measure,
    measureElement,
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
  it("uses direct DOM updates and connects the scroll container and virtual rows", () => {
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
      directDomUpdates: boolean;
      directDomUpdatesMode: string;
      overscan: number;
      getScrollElement(): Element | null;
      estimateSize(): number;
    };
    const row = screen.getByText("Virtual task").closest("[data-index]");
    const sizeContainer = row?.parentElement;

    expect(options.directDomUpdates).toBe(true);
    expect(options.directDomUpdatesMode).toBe("transform");
    expect(options.overscan).toBe(6);
    expect(options.estimateSize()).toBe(130);
    expect(options.getScrollElement()).toBe(sizeContainer?.parentElement);
    expect(virtualizerMock.virtualizer.containerRef).toHaveBeenCalledWith(sizeContainer);
    expect(virtualizerMock.virtualizer.measureElement).toHaveBeenCalledWith(row);
    expect((sizeContainer as HTMLElement).style.height).toBe("");
    expect((row as HTMLElement).style.transform).toBe("");
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
