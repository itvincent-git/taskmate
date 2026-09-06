import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolve } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  TaskFolder,
  MoveTasksResult,
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
  folders: TaskFolder[];
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
  if (saved) {
    const state = JSON.parse(saved) as DemoState;
    state.folders ??= [];
    state.tasks.forEach((task) => { task.folderPath ??= ""; });
    return state;
  }
  return { path, properties: defaultProperties, tasks: [], folders: [] };
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

export function taskFilePath(workspacePath: string, task: Pick<Task, "archived" | "fileName" | "folderPath">): string {
  const separator = workspacePath.includes("\\") && !workspacePath.includes("/") ? "\\" : "/";
  const trimmedRoot = workspacePath.replace(/[\\/]+$/, "");
  const root = trimmedRoot || separator;
  const directory = task.archived ? "archive" : "tasks";
  return `${root}${root.endsWith(separator) ? "" : separator}${directory}${separator}${task.folderPath ? task.folderPath.split("/").join(separator) + separator : ""}${task.fileName}`;
}

function inFolder(path: string, folder: string) {
  return path === folder || path.startsWith(folder + "/");
}

function validateFolderName(name: string) {
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new Error("Invalid cross-platform folder name.");
}

function requireDemoFolder(state: DemoState, archived: boolean, folder: string) {
  if (folder) folder.split("/").forEach(validateFolderName);
  if (folder && !state.folders.some((f) => f.archived === archived && f.path === folder)) throw new Error("Folder does not exist.");
}

function ensureDemoFolder(state: DemoState, archived: boolean, folder: string) {
  const parts = folder.split("/").filter(Boolean);
  parts.forEach((_, index) => {
    const path = parts.slice(0, index + 1).join("/");
    if (!state.folders.some((f) => f.archived === archived && f.path === path)) state.folders.push({ path, archived });
  });
}

function demoFileName(state: DemoState, task: Task) {
  const base = task.title.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80) || "untitled";
  for (let number = -1; ; number += 1) {
    const name = `${base}${number < 0 ? "" : `-${task.id.slice(0, 8)}${number ? `-${number}` : ""}`}.md`;
    if (!state.tasks.some((t) => t.id !== task.id && t.archived === task.archived && t.folderPath === task.folderPath && t.fileName === name)) return name;
  }
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
    if (isTauri) return invoke("open_external_url", { url });
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async openTaskFile(id: string): Promise<void> {
    if (isTauri) return invoke("open_task_file", { id });
  },
  async revealTaskFile(id: string): Promise<void> {
    if (isTauri) return invoke("reveal_task_file", { id });
  },
  async resolveTaskFilePath(workspacePath: string, task: Pick<Task, "archived" | "fileName" | "folderPath">): Promise<string> {
    if (isTauri) return resolve(workspacePath, task.archived ? "archive" : "tasks", task.folderPath || "", task.fileName);
    return taskFilePath(workspacePath, task);
  },
  async openWorkspace(path: string): Promise<WorkspaceSnapshot> {
    if (isTauri) return invoke("open_workspace", { path });
    const state = loadDemo(path);
    state.path = path;
    storeDemo(state);
    return { path, properties: state.properties, tasks: state.tasks.filter((task) => !task.archived).map(summary), indexRebuilt: false, folders: state.folders };
  },
  async createTask(title?: string, folderPath = ""): Promise<Task> {
    if (isTauri) return invoke("create_task", { title, folderPath });
    const state = loadDemo();
    requireDemoFolder(state, false, folderPath);
    const now = new Date().toISOString();
    const task: Task = {
      id: uuid(),
      title: title || "Untitled task",
      fileName: `${title || "Untitled task"}.md`,
      folderPath,
      body: "",
      archived: false,
      createdAt: now,
      updatedAt: now,
      properties: Object.fromEntries(state.properties.filter((property) => property.defaultValue !== undefined).map((property) => [property.key, property.defaultValue])),
      contentHash: uuid(),
    };
    task.fileName = demoFileName(state, task);
    state.tasks.unshift(task);
    storeDemo(state);
    return task;
  },
  async listFolders(): Promise<TaskFolder[]> {
    if (isTauri) return invoke("list_folders");
    return loadDemo().folders.sort((a, b) => a.path.localeCompare(b.path));
  },
  async createFolder(archived: boolean, parent: string, name: string): Promise<void> {
    if (isTauri) return invoke("create_folder", { archived, parent, name });
    const state = loadDemo();
    requireDemoFolder(state, archived, parent);
    validateFolderName(name);
    const path = parent ? `${parent}/${name}` : name;
    if (state.folders.some((f) => f.archived === archived && f.path === path)) throw new Error("A folder with that name already exists.");
    state.folders.push({ path, archived });
    storeDemo(state);
  },
  async moveFolder(archived: boolean, source: string, parent: string, name: string): Promise<void> {
    if (isTauri) return invoke("move_folder", { archived, source, parent, name });
    const state = loadDemo();
    requireDemoFolder(state, archived, source);
    requireDemoFolder(state, archived, parent);
    validateFolderName(name);
    if (!source) throw new Error("Cannot move a task region.");
    const target = parent ? `${parent}/${name}` : name;
    if (source === target) return;
    if (target.startsWith(source + "/")) throw new Error("Cannot move a folder into itself or a descendant.");
    if (state.folders.some((f) => f.archived === archived && f.path === target)) throw new Error("A folder with that name already exists.");
    for (const folder of state.folders) {
      if (folder.archived === archived && inFolder(folder.path, source)) folder.path = target + folder.path.slice(source.length);
    }
    for (const task of state.tasks) {
      if (task.archived === archived && inFolder(task.folderPath || "", source)) task.folderPath = target + task.folderPath!.slice(source.length);
    }
    storeDemo(state);
  },
  async deleteFolder(archived: boolean, folder: string): Promise<void> {
    if (isTauri) return invoke("delete_folder", { archived, folder });
    const state = loadDemo();
    requireDemoFolder(state, archived, folder);
    if (!folder || state.tasks.some((t) => t.archived === archived && inFolder(t.folderPath || "", folder)) || state.folders.some((f) => f.archived === archived && f.path.startsWith(folder + "/"))) throw new Error("Move the folder contents before deleting it.");
    state.folders = state.folders.filter((f) => f.archived !== archived || f.path !== folder);
    storeDemo(state);
  },
  async moveTasks(ids: string[], archived: boolean, folder: string): Promise<MoveTasksResult> {
    if (isTauri) return invoke("move_tasks", { ids, archived, folder });
    const state = loadDemo();
    requireDemoFolder(state, archived, folder);
    if (new Set(ids).size !== ids.length || ids.some((id) => !state.tasks.some((t) => t.id === id && t.archived === archived))) throw new Error("Invalid task selection or region.");
    for (const id of ids) {
      const task = state.tasks.find((t) => t.id === id)!;
      if (task.folderPath === folder) continue;
      task.folderPath = folder;
      task.fileName = demoFileName(state, task);
    }
    storeDemo(state);
    return { completed: ids, remaining: [], error: null };
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
    if (!current) throw new Error("Task not found");
    if (current.contentHash !== task.contentHash) throw new Error("EXTERNAL_CHANGE: The Markdown file changed outside Taskmate.");
    const title = task.title.trim() ? task.title : current?.title ?? task.title;
    const saved = { ...task, folderPath: current.folderPath || "", title, updatedAt: new Date().toISOString(), fileName: `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`, contentHash: uuid() };
    ensureDemoFolder(state, saved.archived, saved.folderPath);
    saved.fileName = demoFileName(state, saved);
    state.tasks = state.tasks.map((candidate) => candidate.id === task.id ? saved : candidate);
    storeDemo(state);
    return saved;
  },
  async queryTasks(query: TaskQuery): Promise<TaskSummary[]> {
    if (isTauri) return invoke("query_tasks", { query });
    const state = loadDemo();
    const search = query.search.toLowerCase();
    const items = state.tasks.filter((task) => task.archived === query.archived && (query.folderPath == null || (task.folderPath || "") === query.folderPath || (query.folderPath !== "" && (task.folderPath || "").startsWith(query.folderPath + "/")))).filter((task) =>
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
        return [{ result: { id: task.id, title: task.title, folderPath: task.folderPath || "", archived: task.archived, snippet }, titleMatch, updatedAt: task.updatedAt }];
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
