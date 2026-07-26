import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { PropertyDefinition, TaskFilter } from "../types";
import { localizedOptionLabel, localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";
import { Popover } from "./ui/Popover";
import { Select } from "./ui/Select";

export function DynamicFilter({ definition, current, onChange }: {
  definition: PropertyDefinition;
  current: TaskFilter[];
  onChange(filters: TaskFilter[]): void;
}) {
  const { locale, t } = useTaskmateI18n();
  const name = localizedPropertyName(definition, locale);
  const [operator, setOperator] = useState(() => current[0]?.operator || defaultOperator(definition));
  const [first, setFirst] = useState(() => valueString(current[0]?.value));
  const [second, setSecond] = useState(() => valueString(current[1]?.value));
  const [multiValues, setMultiValues] = useState<string[]>(() => Array.isArray(current[0]?.value) ? current[0].value.map(String) : []);
  const apply = (nextOperator: string, a = first, b = second) => {
    setOperator(nextOperator);
    if (nextOperator === "set" || nextOperator === "unset") {
      onChange([{ key: definition.key, operator: nextOperator }]);
      return;
    }
    if (!a) {
      onChange([]);
      return;
    }
    const typed = definition.type === "number" ? Number(a) : definition.type === "boolean" ? a === "true" : a;
    if (nextOperator === "range") {
      onChange(b ? [
        { key: definition.key, operator: "gte", value: typed },
        { key: definition.key, operator: "lte", value: definition.type === "number" ? Number(b) : b },
      ] : []);
      return;
    }
    onChange([{ key: definition.key, operator: nextOperator, value: typed }]);
  };

  if (definition.type === "select") {
    return <Select
      ariaLabel={`${name} ${t("properties.filter")}`}
      className="filter-select"
      value={first || "__all"}
      onValueChange={(value) => {
        const next = value === "__all" ? "" : value;
        setFirst(next);
        apply("eq", next);
      }}
      options={[
        { value: "__all", label: `${name}: ${t("common.all")}` },
        ...definition.options.map((option) => ({ value: option.id, label: localizedOptionLabel(option, locale) })),
      ]}
    />;
  }

  if (definition.type === "multiselect" || definition.type === "tags") {
    const setMatch = (nextOperator: string) => {
      setOperator(nextOperator);
      if (nextOperator === "unset") onChange([{ key: definition.key, operator: "unset" }]);
      else onChange(multiValues.length ? [{ key: definition.key, operator: nextOperator, value: multiValues }] : []);
    };
    if (definition.options.length) {
      const toggle = (id: string, checked: boolean) => {
        const values = checked ? [...multiValues, id] : multiValues.filter((value) => value !== id);
        setMultiValues(values);
        onChange(values.length ? [{ key: definition.key, operator, value: values }] : []);
      };
      return <div className="dynamic-filter">
        <Select ariaLabel={`${name} ${t("filter.match")}`} value={operator} onValueChange={setMatch} options={[
          { value: "any", label: t("common.any") },
          { value: "all", label: t("common.all") },
          { value: "unset", label: t("common.unset") },
        ]} />
        <Popover trigger={<Button variant="outline" className="filter-multi-trigger" aria-label={`${name} ${t("properties.filter")}`}>{name}: {multiValues.length || t("common.all")}<ChevronDown size={14} /></Button>}>
          <div className="filter-option-list">
            {definition.options.map((option) => <label key={option.id}><Checkbox checked={multiValues.includes(option.id)} onCheckedChange={(checked) => toggle(option.id, checked === true)} /><span>{localizedOptionLabel(option, locale)}</span>{multiValues.includes(option.id) ? <Check size={13} /> : null}</label>)}
          </div>
        </Popover>
      </div>;
    }
    return <div className="dynamic-filter">
      <Select ariaLabel={`${name} ${t("filter.match")}`} value={operator} onValueChange={setMatch} options={[
        { value: "any", label: t("common.any") }, { value: "all", label: t("common.all") }, { value: "unset", label: t("common.unset") },
      ]} />
      <Input aria-label={`${name} ${t("properties.filter")}`} value={first} placeholder={`${name}…`} onChange={(event) => {
        setFirst(event.target.value);
        const values = event.target.value.split(",").map((value) => value.trim()).filter(Boolean);
        onChange(values.length ? [{ key: definition.key, operator, value: values }] : []);
      }} />
    </div>;
  }

  if (definition.type === "boolean") {
    return <Select ariaLabel={`${name} ${t("properties.filter")}`} value={operator === "unset" ? "unset" : first || "__all"} onValueChange={(value) => {
      if (value === "__all") {
        setFirst("");
        onChange([]);
      } else {
        setFirst(value);
        apply(value === "unset" ? "unset" : "eq", value);
      }
    }} options={[
      { value: "__all", label: `${name}: ${t("common.all")}` },
      { value: "true", label: t("common.yes") },
      { value: "false", label: t("common.no") },
      { value: "unset", label: t("common.unset") },
    ]} />;
  }

  const inputType = definition.type === "number" ? "number" : definition.type === "date" ? "date" : definition.type === "datetime" ? "datetime-local" : "text";
  const operators = definition.type === "text" || definition.type === "textarea" || definition.type === "url"
    ? [["contains", t("filter.contains")], ["notContains", t("filter.excludes")], ["unset", t("filter.empty")], ["set", t("filter.notEmpty")]]
    : [["eq", t("filter.equals")], ["gt", t("filter.greater")], ["lt", t("filter.less")], ["range", t("filter.range")], ["unset", t("common.unset")]];
  return <div className="dynamic-filter detailed">
    <Select ariaLabel={`${name} ${t("filter.match")}`} value={operator} onValueChange={(value) => apply(value)} options={operators.map(([value, label]) => ({ value, label: `${name}: ${label}` }))} />
    {!["set", "unset"].includes(operator) ? <Input type={inputType} aria-label={`${name} ${t("properties.filter")}`} value={first} onChange={(event) => { setFirst(event.target.value); apply(operator, event.target.value); }} /> : null}
    {operator === "range" ? <Input type={inputType} aria-label={`${name} ${t("filter.range")}`} value={second} onChange={(event) => { setSecond(event.target.value); apply(operator, first, event.target.value); }} /> : null}
  </div>;
}

function defaultOperator(definition: PropertyDefinition) {
  if (definition.type === "multiselect" || definition.type === "tags") return "any";
  if (definition.type === "text" || definition.type === "textarea" || definition.type === "url") return "contains";
  return "eq";
}

function valueString(value: unknown) {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value == null ? "" : String(value);
}
