import { memo } from "react";
import type { PropertyDefinition, PropertyOption, Task } from "../types";
import { localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";

export const TaskProperties = memo(function TaskProperties({
  definitions,
  task,
  onChange,
  onCreateOption,
  showHeading = true,
}: {
  definitions: PropertyDefinition[];
  task: Task;
  onChange(key: string, value: unknown): void;
  onCreateOption?(definition: PropertyDefinition, label: string): Promise<PropertyOption>;
  showHeading?: boolean;
}) {
  const { locale, t } = useTaskmateI18n();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeading ? (
        <div className="m-0 flex shrink-0 items-center justify-between border-b border-line p-4">
          <h2 className="m-0 font-heading text-[15px]">{t("editor.properties")}</h2>
          <span className="text-xs tracking-[.1em] text-muted uppercase">{t("editor.frontmatter")}</span>
        </div>
      ) : null}
      <div className={showHeading ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-7" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 pt-3.5 pb-7"}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
          {definitions.map((definition) => (
            <label className="grid gap-1" key={definition.id}>
              <span className="text-xs font-[680] text-muted">{localizedPropertyName(definition, locale)}{definition.required ? <em className="text-danger not-italic">*</em> : null}</span>
              <PropertyInput
                definition={definition}
                value={task.properties[definition.key]}
                onChange={(value) => onChange(definition.key, value)}
                onCreateOption={onCreateOption ? (label) => onCreateOption(definition, label) : undefined}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}, (previous, next) => (
  previous.definitions === next.definitions
  && previous.task.properties === next.task.properties
  && previous.onChange === next.onChange
  && previous.onCreateOption === next.onCreateOption
  && previous.showHeading === next.showHeading
));
