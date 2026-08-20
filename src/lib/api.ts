import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolve } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  GitHistoryEntry,
  GitStatus,
  PropertyDefinition,
  PropertyOption,
  Task,
  TaskQuery,
  TaskSearchResult,
  TaskSummary,
  WorkspaceSnapshot,
} from "../types";

const isTauri = "__TAURI_INTERNALS__" in window;
const STORAGE_KEY = "taskmate-browser-demo";

interface DemoState {
  path: string;
  properties: PropertyDefinition[];
  tasks: Task[];
}

const defaultProperties: PropertyDefinition[] = [
  {
    id: "status",
    key: "status",
    name: "Status",
    type: "select",
    showInDetail: true,
    showInCard: true,
    enableFilter: true,
    enableSort: true,
    role: "status",
    order: 0,
    defaultValue: "not-started",
    options: [
      { id: "not-started", label: "Not started", color: "#718096", order: 0 },
      { id: "in-progress", label: "In progress", color: "#3b82f6", order: 1 },
      { id: "done", label: "Done", color: "#22a06b", order: 2 },
      { id: "on-hold", label: "On hold", color: "#d97706", order: 3 },
    ],
  },
  {
    id: "priority",
    key: "priority",
    name: "Priority",
    type: "select",
    showInDetail: true,
    showInCard: true,
    enableFilter: true,
    enableSort: true,
    order: 1,
    defaultValue: "medium",
    options: [
      { id: "high", label: "High", color: "#dc5245", order: 0 },
      { id: "medium", label: "Medium", color: "#d97706", order: 1 },
      { id: "low", label: "Low", color: "#22a06b", order: 2 },
    ],
  },
  { id: "tags", key: "tags", name: "Tags", type: "tags", showInDetail: true, showInCard: true, enableFilter: true, enableSort: false, order: 2, options: [] },
  { id: "startDate", key: "startDate", name: "Start date", type: "date", showInDetail: true, showInCard: false, enableFilter: true, enableSort: true, order: 3, options: [] },
  { id: "endDate", key: "endDate", name: "Due date", type: "date", showInDetail: true, showInCard: true, enableFilter: true, enableSort: true, order: 4, options: [] },
];

function loadDemo(path = "~/Taskmate"): DemoState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved) as DemoState;
  return { path, properties: defaultProperties, tasks: [] };
}

function storeDemo(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uuid() {
  return crypto.randomUUID();
}

function summary(task: Task): TaskSummary {
  const { body: _body, contentHash: _hash, ...rest } = task;
  return rest;
}

function foldedMatchStart(value: string, search: string): number {
  const needle = Array.from(search.trim().toLocaleLowerCase());
  if (needle.length === 0) return -1;
  const folded: string[] = [];
  const sourceIndexes: number[] = [];
  Array.from(value).forEach((character, sourceIndex) => {
    for (const foldedCharacter of Array.from(character.toLocaleLowerCase())) {
      folded.push(foldedCharacter);
      sourceIndexes.push(sourceIndex);
    }
  });
  for (let index = 0; index <= folded.length - needle.length; index += 1) {
    if (needle.every((character, offset) => folded[index + offset] === character)) return sourceIndexes[index];
  }
  return -1;
}

export function taskFilePath(workspacePath: string, task: Pick<Task, "archived" | "fileName">): string {
  const separator = workspacePath.includes("\\") && !workspacePath.includes("/") ? "\\" : "/";
  const trimmedRoot = workspacePath.replace(/[\\/]+$/, "");
  const root = trimmedRoot || separator;
  const directory = task.archived ? "archive" : "tasks";
  return `${root}${root.endsWith(separator) ? "" : separator}${directory}${separator}${task.fileName}`;
}

export const api = {
  supportsNativeFolderPicker(): boolean {
    return isTauri;
  },
  async pickWorkspaceFolder(defaultPath?: string): Promise<string | null> {
    if (!isTauri) return null;
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
    });
    return typeof selected === "string" ? selected : null;
  },
  async pickSystemFont(currentFont: string | null, title: string, prompt: string): Promise<string | null> {
    if (!isTauri) return null;
    return invoke("pick_system_font", { currentFont, title, prompt });
  },
  async copyText(text: string): Promise<void> {
    if (isTauri) return writeText(text);
    return navigator.clipboard.writeText(text);
  },
  async openExternalUrl(url: string): Promise<void> {
    if (isTauri) return openUrl(url);
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async resolveTaskFilePath(workspacePath: string, task: Pick<Task, "archived" | "fileName">): Promise<string> {
    if (isTauri) return resolve(workspacePath, task.archived ? "archive" : "tasks", task.fileName);
    return taskFilePath(workspacePath, task);
  },
  async openWorkspace(path: string): Promise<WorkspaceSnapshot> {
    if (isTauri) return invoke("open_workspace", { path });
    const state = loadDemo(path);
    state.path = path;
    storeDemo(state);
    return { path, properties: state.properties, tasks: state.tasks.filter((task) => !task.archived).map(summary), indexRebuilt: false };
  },
  async createTask(title?: string): Promise<Task> {
    if (isTauri) return invoke("create_task", { title });
    const state = loadDemo();
    const now = new Date().toISOString();
    const task: Task = {
      id: uuid(),
      title: title || "Untitled task",
      fileName: `${title || "Untitled task"}.md`,
      body: "",
      archived: false,
      createdAt: now,
      updatedAt: now,
      properties: Object.fromEntries(state.properties.filter((property) => property.defaultValue !== undefined).map((property) => [property.key, property.defaultValue])),
      contentHash: uuid(),
    };
    state.tasks.unshift(task);
    storeDemo(state);
    return task;
  },
  async getTask(id: string): Promise<Task> {
    if (isTauri) return invoke("get_task", { id });
    const task = loadDemo().tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error("Task not found");
    return structuredClone(task);
  },
  async saveTask(task: Task): Promise<Task> {
    const input = {
      id: task.id,
      title: task.title,
      body: task.body,
      archived: task.archived,
      createdAt: task.createdAt,
      properties: task.properties,
      expectedHash: task.contentHash,
    };
    if (isTauri) return invoke("save_task", { input });
    const state = loadDemo();
    const current = state.tasks.find((candidate) => candidate.id === task.id);
    const title = task.title.trim() ? task.title : current?.title ?? task.title;
    const saved = { ...task, title, updatedAt: new Date().toISOString(), fileName: `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`, contentHash: uuid() };
    state.tasks = state.tasks.map((candidate) => candidate.id === task.id ? saved : candidate);
    storeDemo(state);
    return saved;
  },
  async queryTasks(query: TaskQuery): Promise<TaskSummary[]> {
    if (isTauri) return invoke("query_tasks", { query });
    const state = loadDemo();
    const search = query.search.toLowerCase();
    const items = state.tasks.filter((task) => task.archived === query.archived).filter((task) =>
      !search || [task.title, task.fileName, task.body, JSON.stringify(task.properties)].some((value) => value.toLowerCase().includes(search)),
    ).filter((task) => query.filters.every((filter) => {
      const value = task.properties[filter.key];
      if (filter.operator === "any") return Array.isArray(filter.value) && (filter.value as unknown[]).some((item) => Array.isArray(value) ? value.includes(item) : value === item);
      return value === filter.value;
    }));
    items.sort((a, b) => {
      for (const sort of query.sorts) {
        const av = sort.key === "title" ? a.title : sort.key === "updatedAt" ? a.updatedAt : a.properties[sort.key];
        const bv = sort.key === "title" ? b.title : sort.key === "updatedAt" ? b.updatedAt : b.properties[sort.key];
        const aNull = av === undefined || av === null;
        const bNull = bv === undefined || bv === null;
        if (aNull !== bNull) return aNull === (sort.nulls === "first") ? -1 : 1;
        const order = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
        if (order !== 0) return sort.direction === "desc" ? -order : order;
      }
      return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);
    });
    return items.map(summary);
  },
  async searchTasks(search: string): Promise<TaskSearchResult[]> {
    if (isTauri) return invoke("search_tasks", { search });
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return [];
    return loadDemo().tasks
      .flatMap((task) => {
        const titleMatch = foldedMatchStart(task.title, needle) >= 0;
        const bodyIndex = foldedMatchStart(task.body, needle);
        if (!titleMatch && bodyIndex < 0) return [];
        const body = Array.from(task.body);
        const start = bodyIndex < 0 ? 0 : Math.max(0, bodyIndex - 80);
        const snippet = body.slice(start, start + 200).join("");
        return [{ result: { id: task.id, title: task.title, archived: task.archived, snippet }, titleMatch, updatedAt: task.updatedAt }];
      })
      .sort((left, right) => Number(right.titleMatch) - Number(left.titleMatch) || right.updatedAt.localeCompare(left.updatedAt))
      .map(({ result }) => result);
  },
  async saveProperties(definitions: PropertyDefinition[]): Promise<PropertyDefinition[]> {
    if (isTauri) return invoke("save_properties", { definitions });
    const state = loadDemo();
    state.properties = definitions;
    storeDemo(state);
    return definitions;
  },
  async createPropertyOption(propertyId: string, label: string): Promise<PropertyOption> {
    if (isTauri) return invoke("create_property_option", { propertyId, label });
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Tag labels cannot be empty.");
    const state = loadDemo();
    const definition = state.properties.find((candidate) => candidate.id === propertyId);
    if (!definition) throw new Error("Property not found.");
    if (definition.type !== "tags") throw new Error("Options can only be created for tags properties.");
    const existing = definition.options.find((option) => option.id.toLocaleLowerCase() === trimmed.toLocaleLowerCase() || option.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (existing) return existing;
    const option = { id: trimmed, label: trimmed, color: "#9C9C9C", order: Math.max(-1, ...definition.options.map((candidate) => candidate.order)) + 1 };
    definition.options.push(option);
    storeDemo(state);
    return option;
  },
  async rebuildIndex(): Promise<TaskSummary[]> {
    if (isTauri) return invoke("rebuild_index");
    return loadDemo().tasks.filter((task) => !task.archived).map(summary);
  },
  async deleteTask(id: string): Promise<void> {
    if (isTauri) return invoke("delete_task", { id });
    const state = loadDemo();
    const task = state.tasks.find((candidate) => candidate.id === id);
    if (!task?.archived) throw new Error("Only archived tasks can be permanently deleted.");
    state.tasks = state.tasks.filter((candidate) => candidate.id !== id);
    storeDemo(state);
  },
  async checkExternalChange(id: string, knownHash: string): Promise<Task | null> {
    if (isTauri) return invoke("check_external_change", { id, knownHash });
    return null;
  },
  async gitStatus(): Promise<GitStatus> {
    if (isTauri) return invoke("git_status");
    return { initialized: false, changes: [], conflicts: [], ahead: 0, behind: 0 };
  },
  async gitAction(action: string, args: Record<string, string> = {}): Promise<GitStatus> {
    if (!isTauri) return { initialized: action === "git_initialize", branch: "main", changes: [], conflicts: [], ahead: 0, behind: 0, lastSync: action === "git_pull" || action === "git_push" ? new Date().toISOString() : undefined };
    return invoke(action, args);
  },
  async gitHistory(): Promise<GitHistoryEntry[]> {
    if (isTauri) return invoke("git_history");
    return [];
  },
  async onWorkspaceFileChange(callback: () => void): Promise<() => void> {
    if (!isTauri) return () => undefined;
    return listen("workspace-file-change", callback);
  },
  async resolveAttachment(path: string): Promise<string> {
    if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
    if (isTauri) return invoke("read_attachment", { path });
    return path;
  },
};
