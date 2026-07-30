import type { PropertyDefinition, Task } from "../types";
import { localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";

export function TaskProperties({
  definitions,
  task,
  onChange,
  showHeading = true,
}: {
  definitions: PropertyDefinition[];
  task: Task;
  onChange(key: string, value: unknown): void;
  showHeading?: boolean;
}) {
  const { locale, t } = useTaskmateI18n();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeading ? (
        <div className="m-0 flex shrink-0 items-center justify-between border-b border-line p-5">
          <h2 className="m-0 font-heading text-[15px]">{t("editor.properties")}</h2>
          <span className="text-[10px] tracking-[.1em] text-muted uppercase">{t("editor.frontmatter")}</span>
        </div>
      ) : null}
      <div className={showHeading ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-[18px] pb-10" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 pt-[18px] pb-10"}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
          {definitions.map((definition) => (
            <label className="grid gap-1.5" key={definition.id}>
              <span className="text-[11px] font-[680] text-muted">{localizedPropertyName(definition, locale)}{definition.required ? <em className="text-danger not-italic">*</em> : null}</span>
              <PropertyInput
                definition={definition}
                value={task.properties[definition.key]}
                onChange={(value) => onChange(definition.key, value)}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
