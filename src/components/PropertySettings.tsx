import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { PropertyDefinition, PropertyType } from "../types";
import { localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { PropertyInput } from "./PropertyInput";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Tooltip } from "./ui/Tooltip";

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
  const { locale, t } = useTaskmateI18n();
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
      name: t("properties.newField"),
      type: "text",
      showInDetail: true,
      showInCard: false,
      enableFilter: false,
      enableSort: false,
      options: [],
      order: definitions.length,
    }]);
  };
  const typeLabels: Record<PropertyType, string> = locale === "zh-CN"
    ? { text: "单行文本", textarea: "多行文本", number: "数字", boolean: "布尔值", select: "单选", multiselect: "多选", tags: "标签", date: "日期", datetime: "日期时间", url: "URL" }
    : { text: "Text", textarea: "Long text", number: "Number", boolean: "Boolean", select: "Select", multiselect: "Multi-select", tags: "Tags", date: "Date", datetime: "Date & time", url: "URL" };

  return (
    <div className="h-full overflow-auto px-8 pt-7 pb-12">
      <div className="mx-auto mb-5 flex max-w-[1160px] items-end justify-between gap-4">
        <div><p className="m-0 mb-1 text-xs font-bold tracking-[.12em] text-muted uppercase">{t("workspace.schema")}</p><h1 className="m-0 mb-1 font-heading text-[28px] tracking-[-.035em]">{t("properties.title")}</h1><p className="m-0 text-muted">{t("properties.description")}</p></div>
        <div className="flex gap-1.5">
          <Button variant="outline" onClick={onRebuild}>{t("properties.rebuild")}</Button>
          <Button variant="outline" onClick={add}><Plus size={16} />{t("properties.add")}</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
        </div>
      </div>
      <div className="mx-auto max-w-[1160px] overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid min-h-9 grid-cols-[minmax(170px,1.2fr)_minmax(120px,.8fr)_105px_repeat(5,56px)_36px] items-center gap-1.5 bg-surface-soft px-3 py-2 text-xs font-bold text-muted"><span>{t("properties.field")}</span><span>{t("properties.key")}</span><span>{t("properties.type")}</span><span>{t("properties.detail")}</span><span>{t("properties.card")}</span><span>{t("properties.filter")}</span><span>{t("properties.sort")}</span><span>{t("properties.required")}</span><span /></div>
        {definitions.slice().sort((a, b) => a.order - b.order).map((definition) => {
          const name = localizedPropertyName(definition, locale);
          return (
            <div className="grid grid-cols-[minmax(170px,1.2fr)_minmax(120px,.8fr)_105px_repeat(5,56px)_36px] items-center gap-1.5 border-t border-line px-3 py-2 text-xs [&>[role=checkbox]]:justify-self-center" key={definition.id}>
              <span className="flex items-center gap-1 text-muted">
                <GripVertical size={15} />
                <Input className="min-w-0 flex-1" aria-label={`${name} ${t("properties.field")}`} value={name} onChange={(event) => update(definition.id, { name: event.target.value })} />
                <Button variant="ghost" size="icon" className="h-[26px] min-h-0 w-6 shrink-0 rounded-[5px] p-0 [&_svg]:w-3" aria-label={`Move ${name} up`} onClick={() => move(definition.id, -1)}><ChevronUp /></Button>
                <Button variant="ghost" size="icon" className="h-[26px] min-h-0 w-6 shrink-0 rounded-[5px] p-0 [&_svg]:w-3" aria-label={`Move ${name} down`} onClick={() => move(definition.id, 1)}><ChevronDown /></Button>
              </span>
              <Input className="min-w-0 w-full" aria-label={`${name} key`} value={definition.key} disabled={definition.role === "status"} onChange={(event) => update(definition.id, { key: event.target.value.replace(/\W/g, "") })} />
              <Tooltip label={lockedIds.has(definition.id) ? t("properties.lockedType") : typeLabels[definition.type]}>
                <span><Select className="w-full min-w-0" ariaLabel={`${name} type`} value={definition.type} disabled={lockedIds.has(definition.id)} onValueChange={(value) => update(definition.id, { type: value as PropertyType })} options={propertyTypes.map((type) => ({ value: type, label: typeLabels[type] }))} /></span>
              </Tooltip>
              {(["showInDetail", "showInCard", "enableFilter", "enableSort", "required"] as const).map((key) => <Checkbox key={key} aria-label={`${name} ${key}`} checked={Boolean(definition[key])} onCheckedChange={(checked) => update(definition.id, { [key]: checked === true })} />)}
              <Button variant="ghost" size="icon" className="text-danger" aria-label={`Delete ${name}`} disabled={definition.role === "status"} onClick={() => onChange(definitions.filter((item) => item.id !== definition.id))}><Trash2 size={15} /></Button>
              {(definition.type === "select" || definition.type === "multiselect" || definition.type === "tags") ? (
                <div className="col-[1/-1] grid grid-cols-[80px_1fr] items-center gap-1.5 rounded-lg bg-surface-soft px-2 py-1.5">
                  <label className="font-semibold text-muted">{t("properties.options")}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {definition.options.map((option, index) => <div className="flex gap-[3px]" key={option.id}>
                      <Input className="w-[30px] p-0.5" type="color" aria-label={`${option.label} color`} value={option.color || "#9C9C9C"} onChange={(event) => update(definition.id, { options: definition.options.map((item) => item.id === option.id ? { ...item, color: event.target.value } : item) })} />
                      <Input className="w-[120px]" value={option.label} onChange={(event) => update(definition.id, { options: definition.options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} />
                      <Button variant="ghost" size="icon" className="h-[26px] min-h-0 w-6 rounded-[5px] p-0 [&_svg]:w-3" aria-label={`Move ${option.label} up`} onClick={() => moveOption(definition, index, -1)}><ChevronUp /></Button>
                      <Button variant="ghost" size="icon" className="h-[26px] min-h-0 w-6 rounded-[5px] p-0 [&_svg]:w-3" aria-label={`Move ${option.label} down`} onClick={() => moveOption(definition, index, 1)}><ChevronDown /></Button>
                      <Button variant="ghost" size="icon" className="h-[26px] min-h-0 w-6 rounded-[5px] p-0 text-danger" aria-label={`Delete ${option.label}`} onClick={() => update(definition.id, { options: definition.options.filter((item) => item.id !== option.id).map((item, order) => ({ ...item, order })) })}>×</Button>
                      {index === definition.options.length - 1 ? <Button variant="ghost" size="icon" className="h-[26px] min-h-0 w-6 rounded-[5px] p-0" aria-label={t("properties.addOption")} onClick={() => update(definition.id, { options: [...definition.options, { id: crypto.randomUUID(), label: t("properties.newOption"), color: "#9C9C9C", order: definition.options.length }] })}>+</Button> : null}
                    </div>)}
                    {definition.options.length === 0 ? <Button variant="outline" size="sm" onClick={() => update(definition.id, { options: [{ id: crypto.randomUUID(), label: t("properties.newOption"), color: "#9C9C9C", order: 0 }] })}>{t("properties.addOption")}</Button> : null}
                  </div>
                </div>
              ) : null}
              <div className="col-[1/-1] grid grid-cols-[80px_minmax(140px,320px)] items-center px-2 pb-1"><label className="font-semibold text-muted">{t("properties.default")}</label><PropertyInput compact definition={definition} value={definition.defaultValue} onChange={(defaultValue) => update(definition.id, { defaultValue })} /></div>
            </div>
          );
        })}
      </div>
      <p className="mx-auto mt-2.5 max-w-[1160px] text-xs text-muted">{t("properties.migrationNote")}</p>
    </div>
  );
}
