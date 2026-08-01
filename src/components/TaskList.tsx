import { memo, useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PropertyDefinition, PropertyOption, TaskSummary } from "../types";
import { TaskCard } from "./TaskCard";

interface Props {
  tasks: TaskSummary[];
  definitions: PropertyDefinition[];
  selectedId?: string;
  compact: boolean;
  emptyState: ReactNode;
  onSelect(task: TaskSummary): void;
  onQuickEdit(task: TaskSummary, key: string, value: unknown): void;
  onCreateOption?(definition: PropertyDefinition, label: string): Promise<PropertyOption>;
}

export const TaskList = memo(function TaskList({ tasks, definitions, selectedId, compact, emptyState, onSelect, onQuickEdit, onCreateOption }: Props) {
  const listHost = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => listHost.current,
    getItemKey: (index) => tasks[index].id,
    estimateSize: () => compact ? 44 : 84,
    overscan: 6,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [compact, virtualizer]);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-2 pb-2" ref={listHost}>
      {tasks.length === 0 ? emptyState : (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const task = tasks[item.index];
            return (
              <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="absolute top-0 left-0 w-full pb-1" style={{ transform: `translateY(${item.start}px)` }}>
                <TaskCard
                  task={task}
                  selected={task.id === selectedId}
                  definitions={definitions}
                  compact={compact}
                  onSelect={() => onSelect(task)}
                  onQuickEdit={(key, value) => onQuickEdit(task, key, value)}
                  onCreateOption={onCreateOption}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
