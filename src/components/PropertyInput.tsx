import type { PropertyDefinition } from "../types";

interface Props {
  definition: PropertyDefinition;
  value: unknown;
  compact?: boolean;
  onChange(value: unknown): void;
}

export function PropertyInput({ definition, value, compact, onChange }: Props) {
  const className = compact ? "property-input compact" : "property-input";
  if (definition.type === "select") {
    return (
      <select className={className} aria-label={definition.name} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Not set</option>
        {definition.options.slice().sort((a, b) => a.order - b.order).map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    );
  }
  if (definition.type === "multiselect" || definition.type === "tags") {
    const values = Array.isArray(value) ? value.map(String) : [];
    return (
      <input
        className={className}
        aria-label={definition.name}
        value={values.join(", ")}
        placeholder="Comma-separated"
        onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
      />
    );
  }
  if (definition.type === "boolean") {
    return (
      <label className="toggle-input" onClick={(event) => event.stopPropagation()}>
        <input aria-label={definition.name} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span />
      </label>
    );
  }
  if (definition.type === "textarea") {
    return <textarea className={className} aria-label={definition.name} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} />;
  }
  return (
    <input
      className={className}
      aria-label={definition.name}
      type={definition.type === "datetime" ? "datetime-local" : definition.type === "date" ? "date" : definition.type === "number" ? "number" : definition.type === "url" ? "url" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(definition.type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}
    />
  );
}
