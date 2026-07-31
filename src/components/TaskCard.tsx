import type { MouseEvent } from "react";
import type { PropertyDefinition, TaskSummary } from "../types";
import { localizedOptionLabel, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";
import { cn } from "../lib/utils";

interface Props {
  task: TaskSummary;
  selected: boolean;
  definitions: PropertyDefinition[];
  compact?: boolean;
  onSelect(): void;
  onQuickEdit(key: string, value: unknown): void;
}

function PropertyValue({ definition, value }: { definition: PropertyDefinition; value: unknown }) {
  const { locale, t } = useTaskmateI18n();
  if (value === undefined || value === null || value === "") return null;
  const option = definition.options.find((candidate) => candidate.id === value);
  if (definition.type === "select") {
    return <span className="inline-flex h-[23px] items-center rounded-[12px] border border-[color-mix(in_srgb,var(--chip)_24%,transparent)] bg-[color-mix(in_srgb,var(--chip)_14%,var(--surface))] px-2 text-xs font-semibold text-[color-mix(in_srgb,var(--chip)_80%,var(--text))]" style={{ "--chip": option?.color || "#718096" } as React.CSSProperties}>{option ? localizedOptionLabel(option, locale) : String(value)}</span>;
  }
  if (definition.type === "multiselect" || definition.type === "tags") {
    return <>{(Array.isArray(value) ? value : []).slice(0, 4).map((item) => {
      const itemOption = definition.options.find((candidate) => candidate.id === item);
      return <span className="inline-flex h-[23px] items-center rounded-[12px] border border-[color-mix(in_srgb,var(--muted)_24%,transparent)] bg-[color-mix(in_srgb,var(--muted)_14%,var(--surface))] px-2 text-xs font-semibold text-[color-mix(in_srgb,var(--muted)_80%,var(--text))]" key={String(item)}>{itemOption ? localizedOptionLabel(itemOption, locale) : String(item)}</span>;
    })}</>;
  }
  if (definition.type === "boolean") return <span className="text-xs text-muted">{value ? t("common.yes") : t("common.no")}</span>;
  if (definition.type === "date" || definition.type === "datetime") return <span className="text-xs text-muted">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(String(value)))}</span>;
  return <span className="text-xs text-muted">{String(value).slice(0, 72)}</span>;
}

export function TaskCard({ task, selected, definitions, compact = false, onSelect, onQuickEdit }: Props) {
  const visible = definitions.filter((definition) => definition.showInCard).sort((a, b) => a.order - b.order);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <article className={cn("cursor-pointer rounded-xl border border-line bg-surface p-2 shadow-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_48%,var(--line))] hover:shadow-panel", selected && "border-accent shadow-[0_0_0_1px_var(--accent)]", compact && "px-2 py-1.5")} onClick={onSelect}>
      <div className={cn("mb-1 truncate text-sm font-normal", compact && "mb-0")} title={task.title}>{task.title}</div>
      {!compact ? (
        <div className="flex min-h-[26px] flex-wrap items-center gap-1">
          {visible.map((definition) => (
            <div className="group relative has-[[data-state=open]]:[&>:first-child]:opacity-0" key={definition.id} onClick={stop}>
              <div className="inline-flex group-hover:opacity-0"><PropertyValue definition={definition} value={task.properties[definition.key]} /></div>
              <div className="pointer-events-none invisible absolute -top-[5px] -left-[5px] z-[3] min-w-[120px] group-hover:pointer-events-auto group-hover:visible group-has-[[data-state=open]]:pointer-events-auto group-has-[[data-state=open]]:visible">
                <PropertyInput compact definition={definition} value={task.properties[definition.key]} onChange={(value) => onQuickEdit(definition.key, value)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
