import type { MouseEvent } from "react";
import type { PropertyDefinition, TaskSummary } from "../types";
import { localizedOptionLabel, localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";
import { Popover } from "./ui/Popover";
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
  const { locale } = useTaskmateI18n();
  const visible = definitions
    .filter((definition) => definition.showInCard && task.properties[definition.key] !== undefined && task.properties[definition.key] !== null && task.properties[definition.key] !== "")
    .sort((a, b) => a.order - b.order);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <article className={cn("cursor-pointer rounded-xl border border-line bg-surface p-3 shadow-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_48%,var(--line))] hover:shadow-panel", selected && "border-accent shadow-[0_0_0_1px_var(--accent)]", compact && "px-2.5 py-2")} onClick={onSelect}>
      <div className={cn("mb-2 truncate text-xs font-[720]", compact && "mb-0")} title={task.title}>{task.title}</div>
      {!compact ? (
        <div className="flex min-h-[26px] flex-wrap items-center gap-1">
          {visible.map((definition) => (
            <div key={definition.id} onClick={stop}>
              <Popover trigger={
                <button type="button" className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0" aria-label={localizedPropertyName(definition, locale)}>
                  <PropertyValue definition={definition} value={task.properties[definition.key]} />
                </button>
              }>
                <div onClick={stop}>
                  <PropertyInput compact definition={definition} value={task.properties[definition.key]} onChange={(value) => onQuickEdit(definition.key, value)} />
                </div>
              </Popover>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
