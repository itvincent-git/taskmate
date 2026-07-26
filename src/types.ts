export type PropertyType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "tags"
  | "date"
  | "datetime"
  | "url";

export interface PropertyOption {
  id: string;
  label: string;
  color?: string;
  order: number;
}

export interface PropertyDefinition {
  id: string;
  key: string;
  name: string;
  type: PropertyType;
  showInDetail: boolean;
  showInCard: boolean;
  enableFilter: boolean;
  enableSort: boolean;
  required?: boolean;
  defaultValue?: unknown;
  options: PropertyOption[];
  order: number;
  role?: "status";
}

export interface TaskSummary {
  id: string;
  title: string;
  fileName: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  properties: Record<string, unknown>;
}

export interface Task extends TaskSummary {
  body: string;
  contentHash: string;
}

export interface TaskFilter {
  key: string;
  operator: string;
  value?: unknown;
}

export interface TaskSort {
  key: string;
  direction: "asc" | "desc";
  nulls: "first" | "last";
}

export interface TaskQuery {
  search: string;
  archived: boolean;
  filters: TaskFilter[];
  sort?: TaskSort;
}

export interface WorkspaceSnapshot {
  path: string;
  properties: PropertyDefinition[];
  tasks: TaskSummary[];
  indexRebuilt: boolean;
}

export type SaveState = "saved" | "dirty" | "saving" | "failed" | "external";

export interface GitStatus {
  initialized: boolean;
  branch?: string;
  changes: string[];
  conflicts: string[];
  remote?: string;
  ahead: number;
  behind: number;
  lastCommit?: string;
}

export type AppView = "tasks" | "properties" | "backup";

export type Language = "en" | "zh";
export type UpdatePhase = "disabled" | "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "restarting" | "error";
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}
export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}
