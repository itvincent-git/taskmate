import type { PropertyDefinition, SavedWorkView, TaskFilter, TaskFolder, TaskQuery, WorkViewQuery } from "../types";

export const WORK_VIEW_STATE_KEY = "taskmate-work-view-state.v1";

export function workViewQuery(query: WorkViewQuery | TaskQuery): WorkViewQuery {
  return { filters: query.filters, sorts: query.sorts, folderPath: query.folderPath ?? null, archived: query.archived };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function sameWorkViewQuery(a: WorkViewQuery | TaskQuery, b: WorkViewQuery | TaskQuery): boolean {
  const normalize = (query: WorkViewQuery | TaskQuery) => ({ ...workViewQuery(query), filters: query.filters.map((filter) => canonical({ key: filter.key, operator: filter.operator, value: filter.value ?? undefined })).sort() });
  return canonical(normalize(a)) === canonical(normalize(b));
}

export function viewNameError(name: string, views: SavedWorkView[], exceptId?: string): "empty" | "duplicate" | null {
  if (!name.trim()) return "empty";
  return views.some((view) => view.id !== exceptId && view.name === name.trim()) ? "duplicate" : null;
}

export function validViewQuery(value: unknown): value is WorkViewQuery {
  if (!value || typeof value !== "object") return false;
  const query = value as WorkViewQuery;
  return (query.folderPath === null || typeof query.folderPath === "string") && typeof query.archived === "boolean"
    && Array.isArray(query.filters) && query.filters.every((f) => f && typeof f.key === "string" && typeof f.operator === "string")
    && Array.isArray(query.sorts) && query.sorts.every((s) => s && typeof s.key === "string" && ["asc", "desc"].includes(s.direction) && ["first", "last"].includes(s.nulls));
}

export function parseViewsFile(raw: string): SavedWorkView[] {
  const file = JSON.parse(raw);
  if (file?.version !== 1 || !Array.isArray(file.views)) throw new Error("Invalid saved views file.");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const view of file.views) {
    if (typeof view.id !== "string" || !view.id.trim() || ids.has(view.id)
      || typeof view.name !== "string" || !view.name.trim() || view.name !== view.name.trim() || names.has(view.name)) throw new Error("Invalid saved views file.");
    ids.add(view.id); names.add(view.name);
    if (!validViewQuery(view)) throw new Error("Invalid saved views file.");
  }
  return file.views;
}

export function relativeTimeFilter(filter: TaskFilter): boolean {
  return filter.key === "updatedAt" && ["withinLastDays", "olderThanDays"].includes(filter.operator);
}

export function invalidViewReference(query: WorkViewQuery | TaskQuery, definitions: PropertyDefinition[], folders: TaskFolder[]): { kind: "folder" | "property" | "option" | "condition"; value: string } | null {
  if (query.folderPath && !folders.some((folder) => folder.archived === query.archived && folder.path === query.folderPath)) return { kind: "folder", value: query.folderPath };
  for (const filter of query.filters) {
    if (relativeTimeFilter(filter)) {
      if (!Number.isSafeInteger(filter.value) || Number(filter.value) < 1) return { kind: "condition", value: "updatedAt" };
      continue;
    }
    const definition = definitions.find((d) => d.key === filter.key);
    if (!definition) return { kind: "property", value: filter.key };
    if (!["eq", "gt", "lt", "gte", "lte", "any", "all", "set", "unset", "contains", "notContains"].includes(filter.operator)) return { kind: "condition", value: filter.key };
    if (["select", "multiselect", "tags"].includes(definition.type) && (definition.type !== "tags" || definition.options.length) && !["set", "unset"].includes(filter.operator)) {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      const missing = values.find((value) => !definition.options.some((option) => option.id === value));
      if (missing !== undefined || values.includes(undefined)) return { kind: "option", value: `${definition.name}: ${String(missing)}` };
    }
  }
  for (const sort of query.sorts) {
    if (!["title", "updatedAt"].includes(sort.key) && !definitions.some((d) => d.key === sort.key)) return { kind: "property", value: sort.key };
  }
  return null;
}

export function loadWorkViewState(path: string): { query: WorkViewQuery; viewId: string | null } | null {
  try {
    const state = JSON.parse(localStorage.getItem(WORK_VIEW_STATE_KEY) || "{}")[path];
    return state && validViewQuery(state.query) && (state.viewId === null || typeof state.viewId === "string") ? state : null;
  } catch { return null; }
}

export function saveWorkViewState(path: string, query: TaskQuery, viewId: string | null) {
  try {
    let states;
    try { states = JSON.parse(localStorage.getItem(WORK_VIEW_STATE_KEY) || "{}"); } catch { states = {}; }
    if (!states || typeof states !== "object" || Array.isArray(states)) states = {};
    states[path] = { query: workViewQuery(query), viewId };
    localStorage.setItem(WORK_VIEW_STATE_KEY, JSON.stringify(states));
  } catch { /* Query preferences are optional when local storage is unavailable. */ }
}
