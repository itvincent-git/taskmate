import { useId } from "react";
import type { PropertyDefinition } from "../types";
import { localizedOptionLabel, localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";

interface Props {
  definition: PropertyDefinition;
  value: unknown;
  compact?: boolean;
  onChange(value: unknown): void;
}

export function PropertyInput({ definition, value, compact, onChange }: Props) {
  const { locale, t } = useTaskmateI18n();
  const optionListId = useId();
  const name = localizedPropertyName(definition, locale);
  const className = compact ? "min-h-7 w-full max-w-40 px-1.5 py-1" : "w-full";
  if (definition.type === "select") {
    const options = definition.options.slice().sort((a, b) => a.order - b.order);
    const selected = options.find((option) => option.id === value);
    return (
      <>
        <Input
          className={className}
          aria-label={name}
          list={optionListId}
          value={selected ? localizedOptionLabel(selected, locale) : String(value ?? "")}
          placeholder={t("common.notSet")}
          onChange={(event) => {
            const next = event.target.value;
            const option = options.find((candidate) => localizedOptionLabel(candidate, locale) === next);
            onChange(next === "" ? null : option?.id ?? next);
          }}
        />
        <datalist id={optionListId}>
          {options.map((option) => <option value={localizedOptionLabel(option, locale)} key={option.id} />)}
        </datalist>
      </>
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
