import { useEffect, useRef, useState } from "react";
import type { TaskFilter } from "../types";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";

export function UpdatedTimeFilter({ current, onChange }: { current?: TaskFilter; onChange(filters: TaskFilter[]): void }) {
  const { t } = useTaskmateI18n();
  const [days, setDays] = useState(String(current?.value ?? 7));
  const emitted = useRef(JSON.stringify(current));
  const signature = JSON.stringify(current);
  useEffect(() => {
    if (emitted.current === signature) return;
    emitted.current = signature;
    setDays(String(current?.value ?? 7));
  }, [signature, current]);
  const operator = current?.operator ?? "any";
  const valid = /^[1-9]\d*$/.test(days) && Number.isSafeInteger(Number(days));
  const emit = (filters: TaskFilter[]) => { emitted.current = JSON.stringify(filters[0]); onChange(filters); };
  return <div className="grid gap-1.5 border-t border-line pt-3">
    <span className="text-xs font-semibold text-muted">{t("filter.updatedAt")}</span>
    <div className="flex gap-2">
      <Select className="min-w-0 flex-1" ariaLabel={t("filter.updatedAt")} value={operator} onValueChange={(next) => {
        if (next === "any") { emit([]); return; }
        const value = next === "olderThanDays" ? 30 : 7;
        setDays(String(value));
        emit([{ key: "updatedAt", operator: next, value }]);
      }} options={[
        { value: "any", label: t("common.all") },
        { value: "withinLastDays", label: t("filter.withinLastDays") },
        { value: "olderThanDays", label: t("filter.olderThanDays") },
      ]} />
      {operator !== "any" && <Input className="w-24" aria-label={t("filter.days")} type="number" min={1} step={1} value={days} aria-invalid={!valid} aria-describedby={!valid ? "updated-days-error" : undefined} onChange={(event) => {
        const value = event.target.value;
        setDays(value);
        if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) emit([{ key: "updatedAt", operator, value: Number(value) }]);
      }} />}
    </div>
    {operator !== "any" && !valid && <span id="updated-days-error" role="alert" className="text-xs text-danger">{t("filter.positiveDays")}</span>}
  </div>;
}
