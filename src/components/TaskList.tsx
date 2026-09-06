import * as ContextMenu from "@radix-ui/react-context-menu";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { memo, useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PropertyDefinition, PropertyOption, TaskSummary } from "../types";
import { TASK_DRAG_TYPE } from "./FolderNavigator";
import { TaskCard } from "./TaskCard";

interface Props {
  tasks: TaskSummary[];
  definitions: PropertyDefinition[];
  selectedId?: string;
  revealSignal?: number;
  compact: boolean;
  emptyState: ReactNode;
  onSelect(task: TaskSummary): void;
  checkedIds?: Set<string>;
  onCheck?(id: string, range: boolean): void;
  onMove?(ids: string[]): void;
  onQuickEdit(task: TaskSummary, key: string, value: unknown): void;
  onCreateOption?(definition: PropertyDefinition, label: string): Promise<PropertyOption>;
}

export const TaskList = memo(function TaskList({ tasks, definitions, selectedId, revealSignal = 0, compact, emptyState, onSelect, onQuickEdit, onCreateOption, checkedIds, onCheck, onMove }: Props) {
  const { locale } = useTaskmateI18n();
  const listHost = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => listHost.current,
    getItemKey: (index) => tasks[index].id,
    estimateSize: () => compact ? 44 : 84,
    paddingStart: 8,
    overscan: 6,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [compact, virtualizer]);

  useEffect(() => {
    if (!revealSignal || !selectedId) return;
    const index = tasks.findIndex((task) => task.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [revealSignal, selectedId, tasks, virtualizer]);

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2" ref={listHost}>
      {tasks.length === 0 ? emptyState : (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const task = tasks[item.index];
            return (
              <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="absolute top-0 left-0 w-full pb-1" style={{ transform: `translateY(${item.start}px)` }}>
                <ContextMenu.Root><ContextMenu.Trigger asChild><div className="relative" draggable={!!onMove} onDragStart={(event) => { event.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify({ archived: task.archived, ids: checkedIds?.has(task.id) ? [...checkedIds] : [task.id] })); event.dataTransfer.effectAllowed = "move"; }}>
                {onCheck && <input type="checkbox" className="absolute top-3 right-3 z-10" aria-label={`Select ${task.title}`} checked={checkedIds?.has(task.id) ?? false} onChange={(event) => onCheck(task.id, "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey))} onClick={(event) => event.stopPropagation()} />}
                <TaskCard
                  task={task}
                  selected={task.id === selectedId}
                  definitions={definitions}
                  compact={compact}
                  onSelect={(event: MouseEvent) => { if (onCheck && (event.metaKey || event.ctrlKey || event.shiftKey)) onCheck(task.id, event.shiftKey); else onSelect(task); }}
                  onQuickEdit={(key, value) => onQuickEdit(task, key, value)}
                  onCreateOption={onCreateOption}
                />
                {onMove && <button className="absolute right-2 bottom-1 rounded bg-surface px-1 text-[10px] text-muted" aria-label={`Move ${task.title}`} onClick={() => onMove(checkedIds?.has(task.id) ? [...checkedIds] : [task.id])}>↗</button>}
                </div></ContextMenu.Trigger>
                {onMove && <ContextMenu.Portal><ContextMenu.Content className="z-[200] rounded border border-line bg-surface p-1 shadow-panel"><ContextMenu.Item className="rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent-soft" onSelect={() => onMove(checkedIds?.has(task.id) ? [...checkedIds] : [task.id])}>{locale === "zh-CN" ? "移动到…" : "Move to…"}</ContextMenu.Item></ContextMenu.Content></ContextMenu.Portal>}
                </ContextMenu.Root>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
