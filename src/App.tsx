import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useVirtualizer } from "@tanstack/react-virtual";
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { createStore, useStore } from "zustand";
import {
  Archive,
  ArchiveRestore,
  Check,
  Cloud,
  Copy,
  Database,
  FileText,
  FolderOpen,
  FolderSync,
  GitBranch,
  LayoutList,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rows3,
  Search,
  Settings2,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { api } from "./lib/api";
import type {
  GitStatus,
  PropertyDefinition,
  SaveState,
  Task,
  TaskFilter,
  TaskQuery,
  TaskSummary,
} from "./types";
import { PropertyInput } from "./components/PropertyInput";
import { PropertySettings } from "./components/PropertySettings";
import { TaskCard } from "./components/TaskCard";
import { TaskProperties } from "./components/TaskProperties";
import { DynamicFilter } from "./components/DynamicFilter";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { Input } from "./components/ui/Input";
import { Select } from "./components/ui/Select";
import { Tooltip } from "./components/ui/Tooltip";
import { TaskmateI18nProvider, localizedPropertyName, useTaskmateI18n } from "./lib/taskmate-i18n";
import "./styles.css";

const initialPath = localStorage.getItem("taskmate-workspace") || `${navigator.platform.includes("Mac") ? "/Users/Shared" : "."}/Taskmate`;
const RECENT_WORKSPACES_KEY = "taskmate-workspaces.v1";
const COMPACT_CARDS_KEY = "taskmate-compact-cards.v1";
const TASK_LIST_VISIBLE_KEY = "taskmate-task-list-visible.v1";
const TASK_LIST_WIDTH_KEY = "taskmate-task-list-width.v1";
const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

type StateUpdate<T> = SetStateAction<T>;
type WorkspaceData = {
  workspacePath: string;
  recentWorkspaces: string[];
  workspaceOpen: boolean;
  loading: boolean;
  definitions: PropertyDefinition[];
  lockedPropertyIds: Set<string>;
  tasks: TaskSummary[];
  task: Task | null;
  openTabs: Array<Pick<Task, "id" | "title" | "fileName">>;
  query: TaskQuery;
  searchDraft: string;
  saveState: SaveState;
  error: string;
  schemaSaving: boolean;
  externalTask: Task | null;
  fileSignal: number;
};
type WorkspaceActions = {
  [K in keyof WorkspaceData as `set${Capitalize<K>}`]: Dispatch<StateUpdate<WorkspaceData[K]>>;
};
type WorkspaceState = WorkspaceData & WorkspaceActions;

function createWorkspaceStore() {
  const initialState: WorkspaceData = {
    workspacePath: initialPath,
    recentWorkspaces: loadRecentWorkspaces(),
    workspaceOpen: false,
    loading: false,
    definitions: [],
    lockedPropertyIds: new Set(),
    tasks: [],
    task: null,
    openTabs: [],
    query: { search: "", archived: false, filters: [] },
    searchDraft: "",
    saveState: "saved",
    error: "",
    schemaSaving: false,
    externalTask: null,
    fileSignal: 0,
  };
  return createStore<WorkspaceState>()((set) => {
    const state = { ...initialState } as WorkspaceState;
    for (const key of Object.keys(initialState) as Array<keyof typeof initialState>) {
      const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof WorkspaceState;
      (state as Record<string, unknown>)[setter] = (value: StateUpdate<unknown>) => set((current) => ({ [key]: typeof value === "function" ? (value as (current: unknown) => unknown)(current[key]) : value }));
    }
    return state;
  });
}

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

function WorkspaceStoreProvider({ children }: { children: ReactNode }) {
  const store = useState(createWorkspaceStore)[0];
  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>;
}

function useWorkspaceState<T>(selector: (state: WorkspaceState) => T) {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("Workspace store is unavailable");
  return useStore(store, selector);
}

function loadRecentWorkspaces() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_WORKSPACES_KEY) || "[]");
    const recent = Array.isArray(stored) ? stored.filter((path): path is string => typeof path === "string").slice(0, 8) : [];
    const legacy = localStorage.getItem("taskmate-workspace");
    return recent.length > 0 || !legacy ? recent : [legacy];
  } catch {
    const legacy = localStorage.getItem("taskmate-workspace");
    return legacy ? [legacy] : [];
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function loadTaskListWidth() {
  const stored = localStorage.getItem(TASK_LIST_WIDTH_KEY);
  const width = stored === null ? 390 : Number(stored);
  return Number.isFinite(width) ? Math.max(290, Math.min(620, width)) : 390;
}

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useTaskmateI18n();
  const content = {
    saved: [Check, t("save.saved")],
    dirty: [Cloud, t("save.dirty")],
    saving: [LoaderCircle, t("save.saving")],
    failed: [Cloud, t("save.failed")],
    external: [Cloud, t("save.external")],
  } as const;
  const [Icon, label] = content[state];
  return <span className={`save-badge ${state}`}><Icon size={14} className={state === "saving" ? "spin" : ""} />{label}</span>;
}

function BackupView() {
  const { t } = useTaskmateI18n();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [remote, setRemote] = useState("");
  const [message, setMessage] = useState("Taskmate backup");
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next = await api.gitStatus();
      setStatus(next);
      setRemote(next.remote || "");
      if (next.initialized) setHistory(await api.gitHistory());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const action = async (command: string, args: Record<string, string> = {}) => {
    setBusy(command);
    setError("");
    try {
      setStatus(await api.gitAction(command, args));
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
      await refresh();
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="settings-view backup-view">
      <div className="view-heading"><div><p className="eyebrow">{t("backup.eyebrow")}</p><h1>{t("backup.title")}</h1><p>{t("backup.description")}</p></div></div>
      {error && <div className="banner error">{error}</div>}
      {!status?.initialized ? (
        <div className="empty-panel"><GitBranch size={38} /><h2>{t("backup.initializeTitle")}</h2><p>{t("backup.initializeDescription")}</p><Button onClick={() => action("git_initialize")} disabled={Boolean(busy)}>{t("backup.initialize")}</Button></div>
      ) : (
        <div className="backup-grid">
          <section className="settings-card">
            <h2>{t("backup.repository")}</h2>
            <dl><div><dt>{t("backup.branch")}</dt><dd>{status.branch || "—"}</dd></div><div><dt>{t("backup.changes")}</dt><dd>{status.changes.length}</dd></div><div><dt>{t("backup.aheadBehind")}</dt><dd>{status.ahead} / {status.behind}</dd></div><div><dt>{t("backup.lastSync")}</dt><dd>{status.lastSync ? new Date(status.lastSync).toLocaleString() : t("common.never")}</dd></div></dl>
            {status.conflicts.length > 0 && <div className="banner error"><strong>{t("backup.conflicts")}</strong>{status.conflicts.map((conflict) => <code key={conflict}>{conflict}</code>)}</div>}
          </section>
          <section className="settings-card">
            <h2>{t("backup.remote")}</h2>
            <label>{t("backup.remoteUrl")}<Input value={remote} onChange={(event) => setRemote(event.target.value)} placeholder="https://github.com/owner/tasks.git" /></label>
            <Button variant="outline" onClick={() => action("git_set_remote", { url: remote })}>{t("backup.saveRemote")}</Button>
            <p className="help">{t("backup.credentialHelp")}</p>
          </section>
          <section className="settings-card">
            <h2>{t("backup.sync")}</h2>
            <label>{t("backup.commitMessage")}<Input value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <div className="button-row"><Button onClick={() => action("git_commit", { message })}>{t("backup.commit")}</Button><Button variant="outline" onClick={() => action("git_pull")}>{t("backup.pull")}</Button><Button variant="outline" onClick={() => action("git_push")}>{t("backup.push")}</Button></div>
          </section>
          <section className="settings-card history"><h2>{t("backup.history")}</h2>{history.length ? history.map((entry) => <code key={entry}>{entry}</code>) : <p className="muted">{t("backup.noCommits")}</p>}</section>
        </div>
      )}
    </div>
  );
}

function WorkspaceSession() {
  const { locale, setLocale, t } = useTaskmateI18n();
  const workspacePath = useWorkspaceState((state) => state.workspacePath);
  const setWorkspacePath = useWorkspaceState((state) => state.setWorkspacePath);
  const recentWorkspaces = useWorkspaceState((state) => state.recentWorkspaces);
  const setRecentWorkspaces = useWorkspaceState((state) => state.setRecentWorkspaces);
  const workspaceOpen = useWorkspaceState((state) => state.workspaceOpen);
  const setWorkspaceOpen = useWorkspaceState((state) => state.setWorkspaceOpen);
  const loading = useWorkspaceState((state) => state.loading);
  const setLoading = useWorkspaceState((state) => state.setLoading);
  const definitions = useWorkspaceState((state) => state.definitions);
  const setDefinitions = useWorkspaceState((state) => state.setDefinitions);
  const lockedPropertyIds = useWorkspaceState((state) => state.lockedPropertyIds);
  const setLockedPropertyIds = useWorkspaceState((state) => state.setLockedPropertyIds);
  const tasks = useWorkspaceState((state) => state.tasks);
  const setTasks = useWorkspaceState((state) => state.setTasks);
  const task = useWorkspaceState((state) => state.task);
  const setTask = useWorkspaceState((state) => state.setTask);
  const openTabs = useWorkspaceState((state) => state.openTabs);
  const setOpenTabs = useWorkspaceState((state) => state.setOpenTabs);
  const query = useWorkspaceState((state) => state.query);
  const setQuery = useWorkspaceState((state) => state.setQuery);
  const searchDraft = useWorkspaceState((state) => state.searchDraft);
  const setSearchDraft = useWorkspaceState((state) => state.setSearchDraft);
  const saveState = useWorkspaceState((state) => state.saveState);
  const setSaveState = useWorkspaceState((state) => state.setSaveState);
  const error = useWorkspaceState((state) => state.error);
  const setError = useWorkspaceState((state) => state.setError);
  const schemaSaving = useWorkspaceState((state) => state.schemaSaving);
  const setSchemaSaving = useWorkspaceState((state) => state.setSchemaSaving);
  const [dark, setDark] = useState(() => localStorage.getItem("taskmate-theme") === "dark");
  const [leftWidth, setLeftWidth] = useState(loadTaskListWidth);
  const [compactCards, setCompactCards] = useState(() => localStorage.getItem(COMPACT_CARDS_KEY) === "true");
  const [taskListVisible, setTaskListVisible] = useState(() => localStorage.getItem(TASK_LIST_VISIBLE_KEY) !== "false");
  const externalTask = useWorkspaceState((state) => state.externalTask);
  const setExternalTask = useWorkspaceState((state) => state.setExternalTask);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [detailNarrow, setDetailNarrow] = useState(false);
  const [propertiesDrawerOpen, setPropertiesDrawerOpen] = useState(false);
  const fileSignal = useWorkspaceState((state) => state.fileSignal);
  const setFileSignal = useWorkspaceState((state) => state.setFileSignal);
  const listHost = useRef<HTMLDivElement>(null);
  const [detailPanel, setDetailPanel] = useState<HTMLElement | null>(null);
  const propertiesButton = useRef<HTMLButtonElement>(null);
  const autoOpened = useRef(false);
  const selectedId = task?.id;
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname;

  const openWorkspace = useCallback(async (requestedPath?: string) => {
    const path = (requestedPath ?? workspacePath).trim();
    if (!path) return;
    setLoading(true);
    setError("");
    try {
      const snapshot = await api.openWorkspace(path);
      const recent = [path, ...recentWorkspaces.filter((candidate) => candidate !== path)].slice(0, 8);
      localStorage.setItem("taskmate-workspace", path);
      localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(recent));
      setWorkspacePath(path);
      setRecentWorkspaces(recent);
      setDefinitions(snapshot.properties);
      setLockedPropertyIds(new Set(snapshot.properties.map((definition) => definition.id)));
      setTasks(snapshot.tasks);
      setQuery({ search: "", archived: false, filters: [] });
      setSearchDraft("");
      setWorkspaceOpen(true);
      navigate("/tasks", { replace: true });
      if (snapshot.tasks[0]) {
        const first = await api.getTask(snapshot.tasks[0].id);
        setTask(first);
        setOpenTabs([{ id: first.id, title: first.title, fileName: first.fileName }]);
      } else {
        setTask(null);
        setOpenTabs([]);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [navigate, recentWorkspaces, workspacePath]);

  const chooseWorkspaceFolder = useCallback(async () => {
    setError("");
    try {
      const selectedPath = await api.pickWorkspaceFolder(workspacePath.trim() || undefined);
      if (!selectedPath) return;
      setWorkspacePath(selectedPath);
      await openWorkspace(selectedPath);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [openWorkspace, workspacePath]);

  useEffect(() => {
    if (autoOpened.current || recentWorkspaces.length === 0) return;
    autoOpened.current = true;
    void openWorkspace(recentWorkspaces[0]);
  }, [openWorkspace, recentWorkspaces]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("taskmate-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    localStorage.setItem(COMPACT_CARDS_KEY, String(compactCards));
    localStorage.setItem(TASK_LIST_VISIBLE_KEY, String(taskListVisible));
  }, [compactCards, taskListVisible]);

  useEffect(() => {
    const element = detailPanel;
    if (!workspaceOpen || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setDetailNarrow(entry.contentRect.width < 760);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [detailPanel, workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen && page !== "/") navigate("/", { replace: true });
  }, [navigate, page, workspaceOpen]);

  useEffect(() => {
    setPropertiesDrawerOpen(false);
  }, [detailNarrow, selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((current) => ({ ...current, search: searchDraft })), 260);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const refresh = useCallback(async (nextQuery = query) => {
    if (!workspaceOpen) return;
    try {
      setTasks(await api.queryTasks(nextQuery));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [query, workspaceOpen]);

  useEffect(() => { void refresh(); }, [query, refresh]);

  useEffect(() => {
    if (!workspaceOpen) return;
    let dispose: () => void = () => {};
    void api.onWorkspaceFileChange(() => setFileSignal((signal) => signal + 1)).then((unlisten) => { dispose = unlisten; });
    return () => dispose();
  }, [workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen || fileSignal === 0) return;
    const timer = window.setTimeout(() => void refresh(), 160);
    return () => window.clearTimeout(timer);
  }, [fileSignal, refresh, workspaceOpen]);

  const save = useCallback(async (current: Task) => {
    setSaveState("saving");
    try {
      const saved = await api.saveTask(current);
      setTask((open) => open?.id === saved.id ? saved : open);
      setOpenTabs((tabs) => tabs.map((tab) => tab.id === saved.id ? { id: saved.id, title: saved.title, fileName: saved.fileName } : tab));
      setSaveState("saved");
      await refresh();
    } catch (cause) {
      const message = errorMessage(cause);
      setSaveState(message.includes("EXTERNAL_CHANGE") ? "external" : "failed");
      setError(message.replace("EXTERNAL_CHANGE:", "").trim());
      if (message.includes("EXTERNAL_CHANGE")) {
        try { setExternalTask(await api.getTask(current.id)); } catch { /* file may have moved */ }
      }
    }
  }, [refresh]);

  useEffect(() => {
    if (!task || saveState !== "dirty") return;
    const timer = window.setTimeout(() => void save(task), 650);
    return () => window.clearTimeout(timer);
  }, [task, save, saveState]);

  useEffect(() => {
    if (!task) return;
    const detect = async () => {
      try {
        const changed = await api.checkExternalChange(task.id, task.contentHash);
        if (changed) {
          if (saveState === "saved") {
            setTask(changed);
            await refresh();
          } else {
            setExternalTask(changed);
            setSaveState("external");
          }
        }
      } catch (cause) {
        setError(`Current file is unavailable: ${errorMessage(cause)}`);
      }
    };
    const debounce = window.setTimeout(() => void detect(), 120);
    const timer = saveState === "saved" ? window.setInterval(() => void detect(), 3000) : 0;
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [fileSignal, refresh, saveState, task]);

  const editTask = (patch: Partial<Task>) => {
    setTask((current) => current ? { ...current, ...patch } : current);
    if (patch.title !== undefined && task) {
      setOpenTabs((tabs) => tabs.map((tab) => tab.id === task.id ? { ...tab, title: patch.title! } : tab));
    }
    setSaveState("dirty");
  };
  const editProperty = (key: string, value: unknown) => editTask({ properties: { ...task?.properties, [key]: value } });
  const copyText = async (text: string) => {
    try {
      await api.copyText(text);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const copyTaskFilePath = async (current: Task) => {
    try {
      await api.copyText(await api.resolveTaskFilePath(workspacePath, current));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const chooseTask = async (id: string) => {
    if (id === selectedId) return;
    if (task && saveState === "dirty") await save(task);
    try {
      const next = await api.getTask(id);
      setTask(next);
      setOpenTabs((tabs) => tabs.some((tab) => tab.id === next.id) ? tabs : [...tabs, { id: next.id, title: next.title, fileName: next.fileName }]);
      setSaveState("saved");
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const create = async () => {
    try {
      const created = await api.createTask(t("tasks.untitled"));
      setTask(created);
      setOpenTabs((tabs) => [...tabs, { id: created.id, title: created.title, fileName: created.fileName }]);
      setSaveState("saved");
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const quickEdit = async (summary: TaskSummary, key: string, value: unknown) => {
    try {
      const full = summary.id === task?.id ? task : await api.getTask(summary.id);
      const saved = await api.saveTask({ ...full, properties: { ...full.properties, [key]: value } });
      if (saved.id === task?.id) setTask(saved);
      await refresh();
    } catch (cause) { setError(`Quick edit failed: ${errorMessage(cause)}`); }
  };
  const archive = async () => {
    if (!task) return;
    const archivedId = task.id;
    await save({ ...task, archived: !task.archived });
    setTask(null);
    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== archivedId));
  };
  const remove = async () => {
    if (!task) return;
    if (!task.archived) {
      setError(t("tasks.archiveBeforeDelete"));
      return;
    }
    setDeleteConfirmOpen(true);
  };
  const confirmDelete = async () => {
    if (!task) return;
    try {
      await api.deleteTask(task.id);
      setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== task.id));
      setTask(null);
      setDeleteConfirmOpen(false);
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
  };

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => listHost.current,
    estimateSize: () => compactCards ? 54 : 154,
    overscan: 6,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [compactCards, virtualizer]);

  const closeTab = async (id: string) => {
    if (task?.id === id && saveState === "dirty") await save(task);
    const index = openTabs.findIndex((tab) => tab.id === id);
    const remaining = openTabs.filter((tab) => tab.id !== id);
    setOpenTabs(remaining);
    if (task?.id !== id) return;
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (!next) {
      setTask(null);
      return;
    }
    try {
      setTask(await api.getTask(next.id));
      setSaveState("saved");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const switchWorkspace = async () => {
    if (task && saveState === "dirty") await save(task);
    setTask(null);
    setOpenTabs([]);
    setWorkspaceOpen(false);
    navigate("/", { replace: true });
  };

  const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).at(-1) || workspacePath;
  const filterDefinitions = definitions.filter((definition) => definition.enableFilter);
  const sortDefinitions = definitions.filter((definition) => definition.enableSort);
  const detailDefinitions = definitions.filter((definition) => definition.showInDetail).sort((a, b) => a.order - b.order);
  const updateFilters = (definition: PropertyDefinition, filters: TaskFilter[]) => {
    const without = query.filters.filter((filter) => filter.key !== definition.key);
    setQuery({ ...query, filters: [...without, ...filters] });
  };
  const beginResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const width = leftWidth;
    const previousUserSelect = document.body.style.userSelect;
    let resizedWidth = width;
    document.body.style.userSelect = "none";
    const move = (moveEvent: PointerEvent) => {
      resizedWidth = Math.max(290, Math.min(620, width + moveEvent.clientX - start));
      setLeftWidth(resizedWidth);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.userSelect = previousUserSelect;
      localStorage.setItem(TASK_LIST_WIDTH_KEY, String(resizedWidth));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  if (!workspaceOpen) {
    return (
      <main className="welcome">
        <div className="welcome-mark"><Check /></div>
        <div className="welcome-language"><Select ariaLabel={t("nav.language")} value={locale} onValueChange={(value) => setLocale(value as typeof locale)} options={[{ value: "en", label: "English" }, { value: "zh-CN", label: "简体中文" }]} /></div>
        <p className="eyebrow">{t("app.tagline")}</p>
        <h1>{t("app.name")}</h1>
        <p>{t("app.description")}</p>
        <label htmlFor="workspace-path">{t("workspace.folder")}</label>
        <div className="workspace-picker">
          <Input id="workspace-path" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void openWorkspace(); }} />
          {api.supportsNativeFolderPicker() ? (
            <Button variant="outline" className="h-11 shrink-0" onClick={() => void chooseWorkspaceFolder()} disabled={loading}>
              <FolderOpen />{t("workspace.chooseFolder")}
            </Button>
          ) : null}
        </div>
        <Button size="lg" onClick={() => void openWorkspace()} disabled={loading || !workspacePath.trim()}>{loading ? <LoaderCircle className="spin" /> : <Database />}{t("workspace.open")}</Button>
        {recentWorkspaces.length > 0 ? (
          <section className="mt-7 w-full max-w-md">
            <p className="mb-2 text-xs font-semibold text-[var(--muted)]">{t("workspace.recent")}</p>
            <div className="grid gap-2">
              {recentWorkspaces.map((path) => (
                <Button key={path} variant="outline" className="w-full justify-start overflow-hidden" onClick={() => void openWorkspace(path)}>
                  <FolderSync size={16} className="shrink-0" /><span className="truncate">{path}</span>
                </Button>
              ))}
            </div>
          </section>
        ) : null}
        {error && <div className="banner error">{error}</div>}
      </main>
    );
  }

  if (page !== "/tasks" && page !== "/properties" && page !== "/backup") {
    return <Navigate to="/tasks" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="flex h-11 shrink-0 items-stretch border-b border-[var(--line)] bg-[var(--surface)] pl-[78px]" data-tauri-drag-region="deep">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2 pt-1" role="tablist" aria-label={t("editor.openFiles")}>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex h-9 min-w-32 max-w-56 items-center rounded-t-md border border-b-0 px-2 text-xs ${tab.id === selectedId && page === "/tasks" ? "border-[var(--line)] bg-[var(--bg)] text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-soft)]"}`}
              role="tab"
              aria-selected={tab.id === selectedId && page === "/tasks"}
            >
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => { navigate("/tasks"); void chooseTask(tab.id); }}>{tab.title}</button>
              <button className="ml-2 grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-[var(--line)] group-hover:opacity-100 focus:opacity-100" aria-label={`${t("tasks.closeTab")}: ${tab.title}`} onClick={() => void closeTab(tab.id)}><X size={12} /></button>
            </div>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-14 shrink-0 flex-col items-center border-r border-[var(--line)] bg-[var(--surface)] py-3">
          <div className="mb-4 grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-white"><Check size={16} /></div>
          <nav className="grid gap-1" aria-label={t("nav.application")}>
            <Tooltip label={t("nav.tasks")}><NavLink to="/tasks" aria-label={t("nav.tasks")} className={`ui-button ui-button-ghost ui-button-icon ${page === "/tasks" ? "active" : ""}`}><LayoutList size={18} /></NavLink></Tooltip>
            <Tooltip label={t("nav.properties")}><NavLink to="/properties" aria-label={t("nav.properties")} className={`ui-button ui-button-ghost ui-button-icon ${page === "/properties" ? "active" : ""}`}><Settings2 size={18} /></NavLink></Tooltip>
            <Tooltip label={t("nav.backup")}><NavLink to="/backup" aria-label={t("nav.backup")} className={`ui-button ui-button-ghost ui-button-icon ${page === "/backup" ? "active" : ""}`}><GitBranch size={18} /></NavLink></Tooltip>
          </nav>
          <div className="mt-auto grid gap-1">
            <DropdownMenu.Root>
              <Tooltip label={t("workspace.switch")}>
                <DropdownMenu.Trigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("workspace.switch")}><FolderSync size={18} /></Button>
                </DropdownMenu.Trigger>
              </Tooltip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="workspace-menu" side="right" align="end" sideOffset={8} collisionPadding={8}>
                  <DropdownMenu.Label className="workspace-menu-label">{t("workspace.current")}</DropdownMenu.Label>
                  <div className="workspace-menu-current">
                    <span className="workspace-menu-name">{workspaceName}</span>
                    <span className="workspace-menu-path" title={workspacePath}>{workspacePath}</span>
                  </div>
                  <DropdownMenu.Separator className="workspace-menu-separator" />
                  <DropdownMenu.Item className="workspace-menu-item" onSelect={() => void switchWorkspace()}>
                    <FolderSync size={16} />
                    {t("workspace.switch")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Select className="!h-9 !w-9 !min-w-9 !px-1" ariaLabel={t("nav.language")} value={locale} onValueChange={(value) => setLocale(value as typeof locale)} options={[{ value: "en", label: "EN" }, { value: "zh-CN", label: "中" }]} />
            <Tooltip label={t("nav.theme")}><Button variant="ghost" size="icon" aria-label={t("nav.theme")} onClick={() => setDark((value) => !value)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</Button></Tooltip>
          </div>
        </aside>
        <main className="workspace !h-full flex-1">
        {error && <div className="toast" role="alert"><span>{error}</span><Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={() => setError("")}>×</Button></div>}
        {page === "/properties" && <PropertySettings definitions={definitions} lockedIds={lockedPropertyIds} onChange={setDefinitions} saving={schemaSaving} onRebuild={async () => {
          setSchemaSaving(true);
          try { setTasks(await api.rebuildIndex()); } catch (cause) { setError(errorMessage(cause)); } finally { setSchemaSaving(false); }
        }} onSave={async () => {
          setSchemaSaving(true);
          try {
            const savedDefinitions = await api.saveProperties(definitions);
            setDefinitions(savedDefinitions);
            setLockedPropertyIds(new Set(savedDefinitions.map((definition) => definition.id)));
          } catch (cause) { setError(errorMessage(cause)); } finally { setSchemaSaving(false); }
        }} />}
        {page === "/backup" && <BackupView />}
        {page === "/tasks" && (
          <>
            <header className="topbar">
              <Tooltip label={taskListVisible ? t("tasks.hideList") : t("tasks.showList")}>
                <Button variant="ghost" size="icon" aria-label={taskListVisible ? t("tasks.hideList") : t("tasks.showList")} onClick={() => setTaskListVisible((visible) => !visible)}>
                  {taskListVisible ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
                </Button>
              </Tooltip>
              <div className="search"><Search size={17} /><Input aria-label={t("tasks.search")} placeholder={t("tasks.search")} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></div>
              <div className="filters">
                {filterDefinitions.map((definition) => <DynamicFilter key={definition.id} definition={definition} current={query.filters.filter((filter) => filter.key === definition.key)} onChange={(filters) => updateFilters(definition, filters)} />)}
                <Select ariaLabel={t("properties.sort")} value={query.sort ? `${query.sort.key}:${query.sort.direction}` : "__recent"} onValueChange={(value) => {
                  const [key, direction] = value === "__recent" ? ["", ""] : value.split(":");
                  setQuery({ ...query, sort: key ? { key, direction: direction as "asc" | "desc", nulls: "last" } : undefined });
                }} options={[
                  { value: "__recent", label: t("tasks.sortRecent") },
                  { value: "title:asc", label: t("tasks.sortTitle") },
                  ...sortDefinitions.flatMap((definition) => [
                    { value: `${definition.key}:asc`, label: `${localizedPropertyName(definition, locale)} · ${t("filter.asc")}` },
                    { value: `${definition.key}:desc`, label: `${localizedPropertyName(definition, locale)} · ${t("filter.desc")}` },
                  ]),
                ]} />
                {query.sort ? <Select ariaLabel={t("tasks.emptyLast")} value={query.sort.nulls} onValueChange={(value) => setQuery({ ...query, sort: { ...query.sort!, nulls: value as "first" | "last" } })} options={[{ value: "last", label: t("tasks.emptyLast") }, { value: "first", label: t("tasks.emptyFirst") }]} /> : null}
              </div>
            </header>
            <div className="split-layout" style={{ gridTemplateColumns: taskListVisible ? `${leftWidth}px 5px minmax(0, 1fr)` : "0 0 minmax(0, 1fr)" }}>
              <section className={`task-list-panel ${taskListVisible ? "" : "invisible overflow-hidden"}`} aria-hidden={!taskListVisible}>
                <div className="list-toolbar" role="toolbar" aria-label={t("tasks.listToolbar")}>
                  <span className="task-count" aria-label={t("tasks.taskCount", { count: tasks.length })}><LayoutList size={17} />{tasks.length}</span>
                  <div className="list-toolbar-actions">
                    <Tooltip label={compactCards ? t("tasks.comfortable") : t("tasks.compact")}>
                      <Button variant="outline" size="icon" className={compactCards ? "active" : ""} aria-label={compactCards ? t("tasks.comfortable") : t("tasks.compact")} onClick={() => setCompactCards((compact) => !compact)}><Rows3 size={17} /></Button>
                    </Tooltip>
                    <Tooltip label={query.archived ? t("tasks.returnActive") : t("tasks.archive")}>
                      <Button variant="outline" size="icon" className={query.archived ? "active" : ""} aria-label={query.archived ? t("tasks.returnActive") : t("tasks.archive")} onClick={() => { setTask(null); setQuery({ ...query, archived: !query.archived }); }}>{query.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</Button>
                    </Tooltip>
                    <Tooltip label={t("tasks.new")}>
                      <Button size="icon" aria-label={t("tasks.new")} onClick={create}><Plus size={17} /></Button>
                    </Tooltip>
                  </div>
                </div>
                <div className="task-list" ref={listHost}>
                  {tasks.length === 0 ? <div className="list-empty"><LayoutList /><h2>{searchDraft || query.filters.length ? t("tasks.noMatches") : t("tasks.nothing")}</h2><p>{query.archived ? t("tasks.archivedHint") : t("tasks.createHint")}</p></div> : (
                    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                      {virtualizer.getVirtualItems().map((item) => {
                        const summary = tasks[item.index];
                        return <div key={summary.id} ref={virtualizer.measureElement} data-index={item.index} className="virtual-row" style={{ transform: `translateY(${item.start}px)` }}><TaskCard task={summary} selected={summary.id === selectedId} definitions={definitions} compact={compactCards} onSelect={() => void chooseTask(summary.id)} onQuickEdit={(key, value) => void quickEdit(summary, key, value)} /></div>;
                      })}
                    </div>
                  )}
                </div>
              </section>
              <div className={`splitter ${taskListVisible ? "" : "invisible"}`} onPointerDown={beginResize} />
              <section className="detail-panel" ref={setDetailPanel}>
                {!task ? <div className="detail-empty"><div className="empty-illustration"><Check /></div><h2>{t("tasks.select")}</h2><p>{t("tasks.selectHint")}</p></div> : (
                  <div className="detail-scroll">
                    <header className="detail-header">
                      <Input className="title-input" aria-label={t("tasks.title")} value={task.title} onChange={(event) => editTask({ title: event.target.value })} />
                      <DropdownMenu.Root>
                        <Tooltip label={t("editor.moreActions")}>
                          <DropdownMenu.Trigger asChild>
                            <Button variant="ghost" size="icon" className="detail-header-button" aria-label={t("editor.moreActions")}><MoreHorizontal /></Button>
                          </DropdownMenu.Trigger>
                        </Tooltip>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className="task-menu" align="end" sideOffset={5} collisionPadding={8}>
                            <DropdownMenu.Item className="workspace-menu-item" onSelect={() => void copyText(task.title)}>
                              <Copy size={15} />
                              {t("editor.copyTitle")}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="workspace-menu-item" onSelect={() => void copyTaskFilePath(task)}>
                              <FileText size={15} />
                              {t("editor.copyFilePath")}
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                      <SaveBadge state={saveState} />
                      {detailNarrow ? (
                        <Tooltip label={t("editor.openProperties")}>
                          <Button ref={propertiesButton} variant="outline" size="icon" className="detail-header-button" aria-label={t("editor.openProperties")} onClick={() => setPropertiesDrawerOpen(true)}><Settings2 /></Button>
                        </Tooltip>
                      ) : null}
                      <Tooltip label={task.archived ? t("tasks.restore") : t("tasks.archiveAction")}><Button variant="ghost" size="icon" className="detail-header-button" aria-label={task.archived ? t("tasks.restore") : t("tasks.archiveAction")} onClick={() => void archive()}>{task.archived ? <ArchiveRestore /> : <Archive />}</Button></Tooltip>
                      <Tooltip label={t("tasks.deleteAction")}><Button variant="ghost" size="icon" className="detail-header-button danger" aria-label={t("tasks.deleteAction")} onClick={() => void remove()}><Trash2 /></Button></Tooltip>
                    </header>
                    <div className="detail-content">
                      <div className="detail-editor">
                        <Suspense fallback={<div className="editor-loading"><LoaderCircle className="spin" />{t("editor.loading")}</div>}>
                          <MarkdownEditor value={task.body} onChange={(body) => editTask({ body })} />
                        </Suspense>
                      </div>
                      {!detailNarrow ? (
                        <aside className="property-panel">
                          <TaskProperties definitions={detailDefinitions} task={task} onChange={editProperty} />
                        </aside>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        <Dialog
          open={propertiesDrawerOpen && detailNarrow && Boolean(task)}
          onOpenChange={setPropertiesDrawerOpen}
          title={t("editor.properties")}
          drawer
          closeLabel={t("common.close")}
          returnFocusRef={propertiesButton}
        >
          {task ? <TaskProperties definitions={detailDefinitions} task={task} onChange={editProperty} showHeading={false} /> : null}
        </Dialog>
        <Dialog
          open={Boolean(externalTask && task)}
          onOpenChange={(open) => { if (!open) setExternalTask(null); }}
          title={t("external.title", { title: task?.title ?? "" })}
          description={t("external.description")}
          closeLabel={t("common.close")}
          footer={<><Button variant="outline" onClick={() => { setExternalTask(null); setSaveState("dirty"); }}>{t("external.keep")}</Button><Button onClick={() => { if (externalTask) setTask(externalTask); setExternalTask(null); setSaveState("saved"); }}>{t("external.reload")}</Button></>}
        >
          {externalTask && task ? <div className="diff-grid"><div><strong>{t("external.editor")}</strong><pre>{task.body}</pre></div><div><strong>{t("external.disk")}</strong><pre>{externalTask.body}</pre></div></div> : null}
        </Dialog>
        <Dialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title={t("tasks.deleteAction")}
          description={t("tasks.deleteConfirm", { title: task?.title ?? "" })}
          closeLabel={t("common.close")}
          footer={<><Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>{t("common.cancel")}</Button><Button variant="destructive" onClick={() => void confirmDelete()}>{t("common.delete")}</Button></>}
        />
      </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <TaskmateI18nProvider>
      <HashRouter>
        <WorkspaceStoreProvider>
          <Routes><Route path="*" element={<WorkspaceSession />} /></Routes>
        </WorkspaceStoreProvider>
      </HashRouter>
    </TaskmateI18nProvider>
  );
}
