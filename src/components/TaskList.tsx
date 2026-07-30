import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PropertyDefinition, TaskSummary } from "../types";
import { TaskCard } from "./TaskCard";

interface Props {
  tasks: TaskSummary[];
  definitions: PropertyDefinition[];
  selectedId?: string;
  compact: boolean;
  emptyState: ReactNode;
  onSelect(task: TaskSummary): void;
  onQuickEdit(task: TaskSummary, key: string, value: unknown): void;
}

export function TaskList({ tasks, definitions, selectedId, compact, emptyState, onSelect, onQuickEdit }: Props) {
  const listHost = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => listHost.current,
    estimateSize: () => compact ? 48 : 130,
    overscan: 6,
    directDomUpdates: true,
    directDomUpdatesMode: "transform",
  });

  useEffect(() => {
    virtualizer.measure();
  }, [compact, virtualizer]);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-3.5" ref={listHost}>
      {tasks.length === 0 ? emptyState : (
        <div ref={virtualizer.containerRef} style={{ position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const task = tasks[item.index];
            return (
              <div key={task.id} ref={virtualizer.measureElement} data-index={item.index} className="absolute top-0 left-0 w-full pb-2">
                <TaskCard
                  task={task}
                  selected={task.id === selectedId}
                  definitions={definitions}
                  compact={compact}
                  onSelect={() => onSelect(task)}
                  onQuickEdit={(key, value) => onQuickEdit(task, key, value)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
