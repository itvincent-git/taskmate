import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { PropertyDefinition, PropertyType } from "../types";
import { PropertyInput } from "./PropertyInput";

interface Props {
  definitions: PropertyDefinition[];
  lockedIds: Set<string>;
  onChange(definitions: PropertyDefinition[]): void;
  onSave(): void;
  onRebuild(): void;
  saving: boolean;
}

const propertyTypes: PropertyType[] = ["text", "textarea", "number", "boolean", "select", "multiselect", "tags", "date", "datetime", "url"];

export function PropertySettings({ definitions, lockedIds, onChange, onSave, onRebuild, saving }: Props) {
  const update = (id: string, patch: Partial<PropertyDefinition>) => onChange(definitions.map((definition) => definition.id === id ? { ...definition, ...patch } : definition));
  const move = (id: string, direction: -1 | 1) => {
    const ordered = definitions.slice().sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((definition) => definition.id === id);
    const other = ordered[index + direction];
    if (!other) return;
    onChange(definitions.map((definition) => definition.id === id ? { ...definition, order: other.order } : definition.id === other.id ? { ...definition, order: ordered[index].order } : definition));
  };
  const moveOption = (definition: PropertyDefinition, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (!definition.options[target]) return;
    const options = definition.options.slice();
    [options[index], options[target]] = [options[target], options[index]];
    update(definition.id, { options: options.map((option, order) => ({ ...option, order })) });
  };
  const add = () => {
    const id = crypto.randomUUID();
    onChange([...definitions, {
      id,
      key: `field_${definitions.length + 1}`,
      name: "New field",
      type: "text",
      showInDetail: true,
      showInCard: false,
      enableFilter: false,
      enableSort: false,
      options: [],
      order: definitions.length,
    }]);
  };
  return (
    <div className="settings-view">
      <div className="view-heading">
        <div><p className="eyebrow">Workspace schema</p><h1>Properties</h1><p>One definition drives task details, cards, filters and sorting.</p></div>
        <div className="heading-actions"><button className="secondary" onClick={onRebuild}>Rebuild index</button><button className="secondary" onClick={add}><Plus size={16} /> Add field</button><button className="primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
      </div>
      <div className="property-table">
        <div className="property-row property-header"><span>Field</span><span>Key</span><span>Type</span><span>Detail</span><span>Card</span><span>Filter</span><span>Sort</span><span>Required</span><span /></div>
        {definitions.slice().sort((a, b) => a.order - b.order).map((definition) => (
          <div className="property-row" key={definition.id}>
            <span className="field-name"><GripVertical size={15} /><input value={definition.name} onChange={(event) => update(definition.id, { name: event.target.value })} /><button className="mini" onClick={() => move(definition.id, -1)}><ChevronUp /></button><button className="mini" onClick={() => move(definition.id, 1)}><ChevronDown /></button></span>
            <input value={definition.key} disabled={definition.role === "status"} onChange={(event) => update(definition.id, { key: event.target.value.replace(/\W/g, "") })} />
            <select aria-label={`${definition.name} type`} value={definition.type} disabled={lockedIds.has(definition.id)} title={lockedIds.has(definition.id) ? "Create a replacement field to migrate this type safely." : undefined} onChange={(event) => update(definition.id, { type: event.target.value as PropertyType })}>{propertyTypes.map((type) => <option key={type}>{type}</option>)}</select>
            {(["showInDetail", "showInCard", "enableFilter", "enableSort", "required"] as const).map((key) => <input key={key} type="checkbox" checked={Boolean(definition[key])} onChange={(event) => update(definition.id, { [key]: event.target.checked })} />)}
            <button className="icon danger" aria-label={`Delete ${definition.name}`} disabled={definition.role === "status"} onClick={() => onChange(definitions.filter((item) => item.id !== definition.id))}><Trash2 size={15} /></button>
            {(definition.type === "select" || definition.type === "multiselect" || definition.type === "tags") && (
              <div className="option-editor">
                <label>Options</label>
                <div className="option-list">
                  {definition.options.map((option, index) => <div key={option.id}><input type="color" aria-label={`${option.label} color`} value={option.color || "#718096"} onChange={(event) => update(definition.id, { options: definition.options.map((item) => item.id === option.id ? { ...item, color: event.target.value } : item) })} /><input value={option.label} onChange={(event) => update(definition.id, { options: definition.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} /><button className="mini" aria-label={`Move ${option.label} up`} onClick={() => moveOption(definition, index, -1)}><ChevronUp /></button><button className="mini" aria-label={`Move ${option.label} down`} onClick={() => moveOption(definition, index, 1)}><ChevronDown /></button><button className="mini danger" onClick={() => update(definition.id, { options: definition.options.filter((item) => item.id !== option.id).map((item, order) => ({ ...item, order })) })}>×</button>{index === definition.options.length - 1 && <button className="mini" onClick={() => update(definition.id, { options: [...definition.options, { id: crypto.randomUUID(), label: "New option", color: "#718096", order: definition.options.length }] })}>+</button>}</div>)}
                  {definition.options.length === 0 && <button className="secondary" onClick={() => update(definition.id, { options: [{ id: crypto.randomUUID(), label: "New option", color: "#718096", order: 0 }] })}>Add option</button>}
                </div>
              </div>
            )}
            <div className="default-editor"><label>Default</label><PropertyInput compact definition={definition} value={definition.defaultValue} onChange={(defaultValue) => update(definition.id, { defaultValue })} /></div>
          </div>
        ))}
      </div>
      <p className="settings-note">Changing an existing field’s type is disabled here to avoid silent data loss. Create a replacement field and migrate values explicitly.</p>
    </div>
  );
}
