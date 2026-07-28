import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolve } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  GitStatus,
  PropertyDefinition,
  Task,
  TaskQuery,
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
  { id: "category", key: "category", name: "Category", type: "select", showInDetail: true, showInCard: true, enableFilter: true, enableSort: false, order: 2, options: [] },
  { id: "tags", key: "tags", name: "Tags", type: "tags", showInDetail: true, showInCard: true, enableFilter: true, enableSort: false, order: 3, options: [] },
  { id: "startDate", key: "startDate", name: "Start date", type: "date", showInDetail: true, showInCard: false, enableFilter: true, enableSort: true, order: 4, options: [] },
  { id: "endDate", key: "endDate", name: "Due date", type: "date", showInDetail: true, showInCard: true, enableFilter: true, enableSort: true, order: 5, options: [] },
  { id: "notes", key: "notes", name: "Notes", type: "textarea", showInDetail: true, showInCard: false, enableFilter: false, enableSort: false, order: 6, options: [] },
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
  async copyText(text: string): Promise<void> {
    if (isTauri) return writeText(text);
    return navigator.clipboard.writeText(text);
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
    const saved = { ...task, updatedAt: new Date().toISOString(), fileName: `${task.title.replace(/[\\/:*?"<>|]/g, "-")}.md`, contentHash: uuid() };
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
    const sort = query.sort;
    items.sort((a, b) => {
      if (!sort) return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);
      const av = sort.key === "title" ? a.title : sort.key === "updatedAt" ? a.updatedAt : a.properties[sort.key];
      const bv = sort.key === "title" ? b.title : sort.key === "updatedAt" ? b.updatedAt : b.properties[sort.key];
      const order = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sort.direction === "desc" ? -order : order;
    });
    return items.map(summary);
  },
  async saveProperties(definitions: PropertyDefinition[]): Promise<PropertyDefinition[]> {
    if (isTauri) return invoke("save_properties", { definitions });
    const state = loadDemo();
    state.properties = definitions;
    storeDemo(state);
    return definitions;
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
  async gitHistory(): Promise<string[]> {
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
