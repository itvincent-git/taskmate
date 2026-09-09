import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import { CalendarDays } from "lucide-react";
import type { PropertyDefinition, PropertyOption, TaskSummary } from "../types";
import { localizedOptionLabel, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";
import { cn } from "../lib/utils";

interface Props {
  task: TaskSummary;
  selected: boolean;
  definitions: PropertyDefinition[];
  compact?: boolean;
  onSelect(event: MouseEvent): void;
  onQuickEdit(key: string, value: unknown): void;
  onCreateOption?(definition: PropertyDefinition, label: string): Promise<PropertyOption>;
}

function PropertyValue({ definition, value }: { definition: PropertyDefinition; value: unknown }) {
  const { locale, t } = useTaskmateI18n();
  if (value === undefined || value === null || value === "") return null;
  const option = definition.options.find((candidate) => candidate.id === value);
  if (definition.type === "select") {
    return <span className="inline-flex h-[22px] items-center rounded-md border border-[color-mix(in_srgb,var(--chip)_20%,var(--line))] bg-[color-mix(in_srgb,var(--chip)_9%,var(--surface))] px-2 text-xs font-semibold text-[color-mix(in_srgb,var(--chip)_68%,var(--text))]" style={{ "--chip": option?.color || "#718096" } as React.CSSProperties}>{option ? localizedOptionLabel(option, locale) : String(value)}</span>;
  }
  if (definition.type === "multiselect" || definition.type === "tags") {
    return <>{(Array.isArray(value) ? value : []).slice(0, 4).map((item) => {
      const itemOption = definition.options.find((candidate) => candidate.id === item);
      return <span className="inline-flex h-[22px] items-center rounded-md border border-line bg-surface-soft px-2 text-xs font-medium text-muted" key={String(item)}>{itemOption ? localizedOptionLabel(itemOption, locale) : String(item)}</span>;
    })}</>;
  }
  if (definition.type === "boolean") return <span className="text-xs text-muted">{value ? t("common.yes") : t("common.no")}</span>;
  if (definition.type === "date" || definition.type === "datetime") return <span className="inline-flex h-[22px] items-center gap-1 px-0.5 text-xs font-medium text-neutral"><CalendarDays size={13} strokeWidth={1.8} />{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(String(value)))}</span>;
  return <span className="text-xs text-muted">{String(value).slice(0, 72)}</span>;
}

export const TaskCard = memo(function TaskCard({ task, selected, definitions, compact = false, onSelect, onQuickEdit, onCreateOption }: Props) {
  const [quickEditorsMounted, setQuickEditorsMounted] = useState(false);
  const quickEditorTimer = useRef<number | null>(null);
  const cancelQuickEditorMount = () => {
    if (quickEditorTimer.current !== null) window.clearTimeout(quickEditorTimer.current);
    quickEditorTimer.current = null;
  };
  const scheduleQuickEditorMount = () => {
    if (quickEditorsMounted || quickEditorTimer.current !== null) return;
    quickEditorTimer.current = window.setTimeout(() => {
      quickEditorTimer.current = null;
      setQuickEditorsMounted(true);
    }, 150);
  };
  useEffect(() => cancelQuickEditorMount, []);
  const visible = definitions.filter((definition) => definition.showInCard).sort((a, b) => a.order - b.order);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <article className={cn("cursor-pointer rounded-[10px] border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,.035)] transition-[transform,box-shadow,border-color,background-color] duration-200 hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--accent)_32%,var(--line))] hover:shadow-[0_5px_16px_rgba(15,23,42,.07)]", selected && "border-[color-mix(in_srgb,var(--accent)_42%,var(--line))] bg-[color-mix(in_srgb,var(--accent-soft)_42%,var(--surface))] shadow-[inset_3px_0_0_var(--accent),0_4px_14px_rgba(15,23,42,.06)]", compact && "px-3 py-2")} onClick={onSelect} onPointerEnter={scheduleQuickEditorMount} onPointerLeave={cancelQuickEditorMount}>
      <div className={cn("mb-2 truncate pr-5 text-sm leading-[1.35] font-semibold tracking-[-.01em] text-foreground", compact && "mb-0")} title={task.title}>{task.title}</div>
      <div className="mb-1 truncate text-[10px] text-muted" title={task.folderPath || "/"}>{task.folderPath || "/"}</div>
      {!compact ? (
        <div className="flex min-h-[22px] flex-wrap items-center gap-1.5">
          {visible.map((definition) => (
            <div className="group relative has-[[data-state=open]]:[&>:first-child]:opacity-0" key={definition.id} onClick={stop}>
              <div className="inline-flex group-hover:opacity-0"><PropertyValue definition={definition} value={task.properties[definition.key]} /></div>
              {quickEditorsMounted ? (
                <div className="pointer-events-none invisible absolute -top-[5px] -left-[5px] z-[3] min-w-[120px] group-hover:pointer-events-auto group-hover:visible group-has-[[data-state=open]]:pointer-events-auto group-has-[[data-state=open]]:visible">
                  <PropertyInput compact definition={definition} value={task.properties[definition.key]} onChange={(value) => onQuickEdit(definition.key, value)} onCreateOption={onCreateOption ? (label) => onCreateOption(definition, label) : undefined} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
});
