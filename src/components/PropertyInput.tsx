import type { PropertyDefinition } from "../types";
import { localizedOptionLabel, localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Textarea } from "./ui/Textarea";

interface Props {
  definition: PropertyDefinition;
  value: unknown;
  compact?: boolean;
  onChange(value: unknown): void;
}

export function PropertyInput({ definition, value, compact, onChange }: Props) {
  const { locale, t } = useTaskmateI18n();
  const name = localizedPropertyName(definition, locale);
  const className = compact ? "min-h-[30px] w-full max-w-40 px-[7px] py-1" : "w-full";
  if (definition.type === "select") {
    return (
      <Select
        className={className}
        ariaLabel={name}
        value={String(value ?? "")}
        placeholder={t("common.notSet")}
        onValueChange={(next) => onChange(next === "__unset" ? null : next)}
        options={[{ value: "__unset", label: t("common.notSet") }, ...definition.options.slice().sort((a, b) => a.order - b.order).map((option) => ({ value: option.id, label: localizedOptionLabel(option, locale) }))]}
      />
    );
  }
  if (definition.type === "multiselect" || definition.type === "tags") {
    const values = Array.isArray(value) ? value.map(String) : [];
    return (
      <Input
        className={className}
        aria-label={name}
        value={values.join(", ")}
        placeholder={t("quick.commaSeparated")}
        onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
      />
    );
  }
  if (definition.type === "boolean") {
    return (
      <Checkbox aria-label={name} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} onClick={(event) => event.stopPropagation()} />
    );
  }
  if (definition.type === "textarea") {
    return <Textarea className={className} aria-label={name} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} />;
  }
  return (
    <Input
      className={className}
      aria-label={name}
      type={definition.type === "datetime" ? "datetime-local" : definition.type === "date" ? "date" : definition.type === "number" ? "number" : definition.type === "url" ? "url" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(definition.type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}
    />
  );
}
