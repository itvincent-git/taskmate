import type { MouseEvent } from "react";
import type { PropertyDefinition, TaskSummary } from "../types";
import { localizedOptionLabel, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";

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
    return <span className="chip" style={{ "--chip": option?.color || "#718096" } as React.CSSProperties}>{option ? localizedOptionLabel(option, locale) : String(value)}</span>;
  }
  if (definition.type === "multiselect" || definition.type === "tags") {
    return <>{(Array.isArray(value) ? value : []).slice(0, 4).map((item) => {
      const itemOption = definition.options.find((candidate) => candidate.id === item);
      return <span className="chip neutral" key={String(item)}>{itemOption ? localizedOptionLabel(itemOption, locale) : String(item)}</span>;
    })}</>;
  }
  if (definition.type === "boolean") return <span className="property-text">{value ? t("common.yes") : t("common.no")}</span>;
  if (definition.type === "date" || definition.type === "datetime") return <span className="property-text">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(String(value)))}</span>;
  return <span className="property-text">{String(value).slice(0, 72)}</span>;
}

export function TaskCard({ task, selected, definitions, compact = false, onSelect, onQuickEdit }: Props) {
  const visible = definitions.filter((definition) => definition.showInCard).sort((a, b) => a.order - b.order);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <article className={`task-card ${selected ? "selected" : ""} ${compact ? "!px-3 !py-2.5" : ""}`} onClick={onSelect}>
      <div className={`task-card-title ${compact ? "!mb-0 !text-sm" : ""}`} title={task.title}>{task.title}</div>
      {!compact ? (
        <div className="task-card-properties">
          {visible.map((definition) => (
            <div className="card-property" key={definition.id} onClick={stop}>
              <PropertyValue definition={definition} value={task.properties[definition.key]} />
              <div className="quick-editor">
                <PropertyInput compact definition={definition} value={task.properties[definition.key]} onChange={(value) => onQuickEdit(definition.key, value)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
