import * as Popover from "@radix-ui/react-popover";
import { enUS, zhCN } from "react-day-picker/locale";
import { CalendarDays, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { PropertyDefinition, PropertyOption } from "../types";
import { localizedOptionLabel, localizedPropertyName, useTaskmateI18n } from "../lib/taskmate-i18n";
import { Checkbox } from "./ui/Checkbox";
import { Button } from "./ui/Button";
import { Calendar } from "./ui/Calendar";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Textarea } from "./ui/Textarea";

interface Props {
  definition: PropertyDefinition;
  value: unknown;
  compact?: boolean;
  datePicker?: boolean;
  onChange(value: unknown): void;
  onCreateOption?(label: string): Promise<PropertyOption>;
}

function parseDate(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : undefined;
}

function formatDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DateInput({ definition, value, compact, onChange }: Props) {
  const { locale, t } = useTaskmateI18n();
  const [open, setOpen] = useState(false);
  const name = localizedPropertyName(definition, locale);
  const selected = parseDate(value);
  const rawValue = String(value ?? "");
  const displayValue = selected
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(selected)
    : rawValue || t("common.notSet");

  return (
    <div className={`flex items-center gap-1 ${compact ? "w-full max-w-40" : "w-full"}`}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="outline" aria-label={name} className="min-w-0 flex-1 justify-start px-3 font-normal">
            <CalendarDays className="size-4 shrink-0 text-muted" />
            <span className={rawValue ? "truncate" : "truncate text-muted"}>{displayValue}</span>
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="z-[350] w-auto rounded-lg border border-line bg-surface p-0 shadow-[0_12px_30px_rgba(0,0,0,.14)]" align="start" sideOffset={6}>
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              locale={locale === "zh-CN" ? zhCN : enUS}
              onSelect={(date) => {
                if (!date) return;
                onChange(formatDate(date));
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {rawValue ? <Button variant="ghost" size="icon" className="shrink-0" aria-label={`${t("common.unset")} ${name}`} onClick={() => onChange(null)}><X className="size-4" /></Button> : null}
    </div>
  );
}

function TagsInput({ definition, value, compact, onChange, onCreateOption }: Props) {
  const { locale } = useTaskmateI18n();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const values = Array.isArray(value) ? value.map(String) : [];
  const options = useMemo(() => definition.options.slice().sort((a, b) => a.order - b.order), [definition.options]);
  const query = input.trim().toLocaleLowerCase();
  const candidates = options.filter((option) => !query || option.id.toLocaleLowerCase().includes(query) || localizedOptionLabel(option, locale).toLocaleLowerCase().includes(query));
  const showSuggestions = candidates.length > 0 || query.length > 0;
  const matchingValue = (option: PropertyOption) => values.find((item) => item.toLocaleLowerCase() === option.id.toLocaleLowerCase() || item.toLocaleLowerCase() === option.label.toLocaleLowerCase());
  const toggleOption = (option: PropertyOption) => {
    const selected = matchingValue(option);
    onChange(selected === undefined ? [...values, option.id] : values.filter((item) => item !== selected));
  };
  const submit = async () => {
    const label = input.trim();
    if (!label || creating) return;
    const existing = options.find((option) => option.id.toLocaleLowerCase() === label.toLocaleLowerCase() || localizedOptionLabel(option, locale).toLocaleLowerCase() === label.toLocaleLowerCase());
    if (existing) {
      if (matchingValue(existing) === undefined) onChange([...values, existing.id]);
      setInput("");
      return;
    }
    if (!onCreateOption) return;
    setCreating(true);
    try {
      const created = await onCreateOption(label);
      if (matchingValue(created) === undefined) onChange([...values, created.id]);
      setInput("");
    } catch {
      // The caller reports the error; retaining input lets the user retry.
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover.Root open={open && showSuggestions} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div data-state={open ? "open" : "closed"} className={`flex min-h-[34px] flex-wrap items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 focus-within:border-accent focus-within:ring-3 focus-within:ring-[color-mix(in_srgb,var(--accent)_12%,transparent)] ${compact ? "w-full max-w-40" : "w-full"}`} onClick={() => setOpen(true)}>
          {values.map((item) => {
            const option = options.find((candidate) => candidate.id === item);
            const label = option ? localizedOptionLabel(option, locale) : item;
            return <span className="inline-flex min-w-0 items-center gap-0.5 rounded bg-surface-soft px-1.5 py-0.5 text-xs" key={item}><span className="truncate">{label}</span><button type="button" className="text-muted hover:text-danger" aria-label={`Remove ${label}`} onClick={(event) => { event.stopPropagation(); onChange(values.filter((valueItem) => valueItem !== item)); }}><X size={12} /></button></span>;
          })}
          <input
            className="min-w-12 flex-1 border-0 bg-transparent px-0.5 text-xs outline-none"
            aria-label={localizedPropertyName(definition, locale)}
            value={input}
            disabled={creating}
            onFocus={() => setOpen(true)}
            onChange={(event) => { setInput(event.target.value); setOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Backspace" && input === "" && values.length > 0) {
                onChange(values.slice(0, -1));
              }
            }}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content role="listbox" aria-multiselectable="true" className="z-[350] max-h-[min(360px,var(--radix-popover-content-available-height))] min-w-[210px] overflow-auto rounded-lg border border-line bg-surface p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.14)]" align="start" sideOffset={5} onOpenAutoFocus={(event) => event.preventDefault()}>
          {candidates.map((option) => {
            const selected = matchingValue(option) !== undefined;
            return <button type="button" role="option" aria-selected={selected} className="flex min-h-[30px] w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-accent-soft hover:text-accent" key={option.id} onClick={() => toggleOption(option)}><Check size={13} className={selected ? "opacity-100" : "opacity-0"} /><span>{localizedOptionLabel(option, locale)}</span></button>;
          })}
          {candidates.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted">{input.trim()}</div> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PropertyInput({ definition, value, compact, datePicker, onChange, onCreateOption }: Props) {
  const { locale, t } = useTaskmateI18n();
  const name = localizedPropertyName(definition, locale);
  const className = compact ? "min-h-7 w-full max-w-40 px-1.5 py-1" : "w-full";
  if (definition.type === "select") {
    return <Select className={className} ariaLabel={name} value={String(value ?? "")} placeholder={t("common.notSet")} onValueChange={(next) => onChange(next === "__unset" ? null : next)} options={[{ value: "__unset", label: t("common.notSet") }, ...definition.options.slice().sort((a, b) => a.order - b.order).map((option) => ({ value: option.id, label: localizedOptionLabel(option, locale) }))]} />;
  }
  if (definition.type === "tags") return <TagsInput definition={definition} value={value} compact={compact} onChange={onChange} onCreateOption={onCreateOption} />;
  if (definition.type === "multiselect") {
    const values = Array.isArray(value) ? value.map(String) : [];
    return <Input className={className} aria-label={name} value={values.join(", ")} placeholder={t("quick.commaSeparated")} onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />;
  }
  if (definition.type === "boolean") return <Checkbox aria-label={name} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} onClick={(event) => event.stopPropagation()} />;
  if (definition.type === "textarea") return <Textarea className={className} aria-label={name} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} />;
  if (definition.type === "date" && datePicker) return <DateInput definition={definition} value={value} compact={compact} onChange={onChange} />;
  return <Input className={className} aria-label={name} type={definition.type === "datetime" ? "datetime-local" : definition.type === "date" ? "date" : definition.type === "number" ? "number" : definition.type === "url" ? "url" : "text"} value={String(value ?? "")} onChange={(event) => onChange(definition.type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)} />;
}
