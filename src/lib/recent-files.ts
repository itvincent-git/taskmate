import type { Task } from "../types";

export type RecentFile = Pick<Task, "id" | "title" | "fileName" | "archived" | "folderPath">;
const STORAGE_KEY = "taskmate-recent-files.v1";

function readWorkspaces(): Record<string, RecentFile[]> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

export function loadRecentFiles(path: string): RecentFile[] {
  const files = readWorkspaces()[path];
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  return files.filter((file) => {
    if (!file || typeof file.id !== "string" || typeof file.title !== "string" || typeof file.fileName !== "string" || typeof file.archived !== "boolean" || seen.has(file.id)) return false;
    seen.add(file.id);
    return true;
  }).slice(0, 50);
}

export function saveRecentFiles(path: string, files: RecentFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readWorkspaces(), [path]: files }));
  } catch {
    // History remains available in memory when storage is unavailable.
  }
}
