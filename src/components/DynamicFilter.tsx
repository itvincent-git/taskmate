import { useState } from "react";
import type { PropertyDefinition, TaskFilter } from "../types";

export function DynamicFilter({ definition, current, onChange }: {
  definition: PropertyDefinition;
  current: TaskFilter[];
  onChange(filters: TaskFilter[]): void;
}) {
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
    const value = definition.type === "multiselect" || definition.type === "tags" ? [typed] : typed;
    onChange([{ key: definition.key, operator: nextOperator, value }]);
  };

  if (definition.type === "select" || definition.type === "multiselect" || definition.type === "tags") {
    const multi = definition.type !== "select";
    return <div className="dynamic-filter">
      {multi && <select aria-label={`${definition.name} match`} value={operator} onChange={(event) => {
        const nextOperator = event.target.value;
        setOperator(nextOperator);
        if (nextOperator === "unset") onChange([{ key: definition.key, operator: "unset" }]);
        else {
          const values = definition.options.length ? multiValues : first.split(",").map((value) => value.trim()).filter(Boolean);
          onChange(values.length ? [{ key: definition.key, operator: nextOperator, value: values }] : []);
        }
      }}>
        <option value="any">Any</option><option value="all">All</option><option value="unset">Unset</option>
      </select>}
      {definition.options.length ? <select multiple={multi} aria-label={`Filter by ${definition.name}`} value={multi ? multiValues : first} onChange={(event) => {
        if (multi) {
          const values = Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean);
          setMultiValues(values);
          onChange(values.length ? [{ key: definition.key, operator, value: values }] : []);
        } else {
          setFirst(event.target.value);
          apply("eq", event.target.value);
        }
      }}>
        <option value="">{definition.name}: All</option>
        {definition.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select> : <input aria-label={`Filter by ${definition.name}`} value={first} placeholder={`${definition.name}…`} onChange={(event) => {
        setFirst(event.target.value);
        const values = event.target.value.split(",").map((value) => value.trim()).filter(Boolean);
        onChange(values.length ? [{ key: definition.key, operator: multi ? operator : "eq", value: multi ? values : values[0] }] : []);
      }} />}
    </div>;
  }

  if (definition.type === "boolean") {
    return <select aria-label={`Filter by ${definition.name}`} value={operator === "unset" ? "unset" : first} onChange={(event) => {
      const value = event.target.value;
      setFirst(value);
      apply(value === "unset" ? "unset" : "eq", value);
    }}>
      <option value="">{definition.name}: All</option><option value="true">Yes</option><option value="false">No</option><option value="unset">Unset</option>
    </select>;
  }

  const inputType = definition.type === "number" ? "number" : definition.type === "date" ? "date" : definition.type === "datetime" ? "datetime-local" : "text";
  const operators = definition.type === "text" || definition.type === "textarea" || definition.type === "url"
    ? [["contains", "Contains"], ["notContains", "Excludes"], ["unset", "Empty"], ["set", "Not empty"]]
    : [["eq", "Equals"], ["gt", "After / greater"], ["lt", "Before / less"], ["range", "Range"], ["unset", "Unset"]];
  return <div className="dynamic-filter detailed">
    <select aria-label={`${definition.name} condition`} value={operator} onChange={(event) => apply(event.target.value)}>
      {operators.map(([value, label]) => <option key={value} value={value}>{definition.name}: {label}</option>)}
    </select>
    {!["set", "unset"].includes(operator) && <input type={inputType} aria-label={`Filter by ${definition.name}`} value={first} onChange={(event) => { setFirst(event.target.value); apply(operator, event.target.value); }} />}
    {operator === "range" && <input type={inputType} aria-label={`${definition.name} range end`} value={second} onChange={(event) => { setSecond(event.target.value); apply(operator, first, event.target.value); }} />}
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
