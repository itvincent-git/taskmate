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
    <div className="task-properties">
      {showHeading ? (
        <div className="section-title">
          <h2>{t("editor.properties")}</h2>
          <span>{t("editor.frontmatter")}</span>
        </div>
      ) : null}
      <div className="property-scroll">
        <div className="property-grid">
          {definitions.map((definition) => (
            <label key={definition.id}>
              <span>{localizedPropertyName(definition, locale)}{definition.required ? <em>*</em> : null}</span>
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
