import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { createStore, useStore } from "zustand";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  Download,
  Database,
  FileText,
  FolderOpen,
  FolderSync,
  GitBranch,
  LayoutList,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
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
  PropertyOption,
  SaveState,
  Task,
  TaskFilter,
  TaskQuery,
  TaskSearchResult,
  TaskSort,
  TaskSummary,
} from "./types";
import { PropertySettings } from "./components/PropertySettings";
import { TaskList } from "./components/TaskList";
import { TaskSearchPanel } from "./components/TaskSearchPanel";
import { TaskProperties } from "./components/TaskProperties";
import { DynamicFilter } from "./components/DynamicFilter";
import { EditorShortcutSettings } from "./components/EditorShortcutSettings";
import { Button, buttonVariants } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { Input } from "./components/ui/Input";
import { Progress } from "./components/ui/Progress";
import { Select } from "./components/ui/Select";
import { Tooltip } from "./components/ui/Tooltip";
import { TaskmateI18nProvider, localizedPropertyName, useTaskmateI18n } from "./lib/taskmate-i18n";
import { useUpdater } from "./hooks/useUpdater";
import { localizeUpdateNotes } from "./lib/update-notes";
import { cn } from "./lib/utils";

const initialPath = localStorage.getItem("taskmate-workspace") || `${navigator.platform.includes("Mac") ? "/Users/Shared" : "."}/Taskmate`;
const RECENT_WORKSPACES_KEY = "taskmate-workspaces.v1";
const COMPACT_CARDS_KEY = "taskmate-compact-cards.v1";
const FILTER_SORT_KEY = "taskmate-filter-sort.v1";
const TASK_LIST_VISIBLE_KEY = "taskmate-task-list-visible.v1";
const TASK_PANEL_KEY = "taskmate-task-panel.v1";
const TASK_SEARCH_KEY = "taskmate-task-search.v1";
const TASK_LIST_WIDTH_KEY = "taskmate-task-list-width.v1";
const TASK_PROPERTIES_WIDTH_KEY = "taskmate-task-properties-width.v1";
const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

type StateUpdate<T> = SetStateAction<T>;
type WorkspacePage = "/properties" | "/backup" | "/settings";
type OpenTab = ({ kind: "task" } & Pick<Task, "id" | "title" | "fileName" | "archived">) | { kind: "page"; id: WorkspacePage };
type WorkspaceData = {
  workspacePath: string;
  recentWorkspaces: string[];
  workspaceOpen: boolean;
  loading: boolean;
  definitions: PropertyDefinition[];
  lockedPropertyIds: Set<string>;
  tasks: TaskSummary[];
  task: Task | null;
  openTabs: OpenTab[];
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
    query: { search: "", archived: false, filters: [], sorts: [] },
    searchDraft: localStorage.getItem(TASK_SEARCH_KEY) || "",
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

function useLatestCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
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

function loadTaskPropertiesWidth() {
  const stored = localStorage.getItem(TASK_PROPERTIES_WIDTH_KEY);
  const width = stored === null ? 320 : Number(stored);
  return Number.isFinite(width) ? Math.max(240, Math.min(520, width)) : 320;
}

function loadTaskPanel(): "files" | "search" {
  return localStorage.getItem(TASK_PANEL_KEY) === "search" ? "search" : "files";
}

type StoredFilterSort = Pick<TaskQuery, "filters"> & { sorts?: TaskSort[]; sort?: TaskSort };

function loadFilterSort(path: string): Pick<TaskQuery, "filters" | "sorts"> {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_SORT_KEY) || "{}") as Record<string, StoredFilterSort>;
    const preference = stored[path];
    if (!preference || !Array.isArray(preference.filters)) return { filters: [], sorts: [] };
    return { filters: preference.filters, sorts: Array.isArray(preference.sorts) ? preference.sorts : preference.sort ? [preference.sort] : [] };
  } catch {
    return { filters: [], sorts: [] };
  }
}

function saveFilterSort(path: string, query: TaskQuery) {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_SORT_KEY) || "{}") as Record<string, StoredFilterSort>;
    stored[path] = { filters: query.filters, sorts: query.sorts };
    localStorage.setItem(FILTER_SORT_KEY, JSON.stringify(stored));
  } catch {
    localStorage.setItem(FILTER_SORT_KEY, JSON.stringify({ [path]: { filters: query.filters, sorts: query.sorts } }));
  }
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
  return <span className={cn("inline-flex items-center gap-[5px] whitespace-nowrap text-xs text-muted", (state === "failed" || state === "external") && "text-danger", state === "dirty" && "text-[#d97706]")}><Icon size={14} className={state === "saving" ? "animate-spin" : ""} />{label}</span>;
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
    <div className="h-full overflow-auto px-8 pt-7 pb-12">
      <div className="mx-auto mb-5 flex max-w-[1160px] items-end justify-between gap-4"><div><p className="m-0 mb-1 text-xs font-bold tracking-[.12em] text-muted uppercase">{t("backup.eyebrow")}</p><h1 className="m-0 mb-1 font-heading text-[28px] tracking-[-.035em]">{t("backup.title")}</h1><p className="m-0 text-muted">{t("backup.description")}</p></div></div>
      {error && <div className="my-2.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] px-3 py-2 text-danger">{error}</div>}
      {!status?.initialized ? (
        <div className="mx-auto my-16 max-w-[620px] rounded-2xl border border-dashed border-line p-10 text-center text-muted"><GitBranch className="mx-auto" size={38} /><h2 className="mb-1 font-heading text-foreground">{t("backup.initializeTitle")}</h2><p>{t("backup.initializeDescription")}</p><Button onClick={() => action("git_initialize")} disabled={Boolean(busy)}>{t("backup.initialize")}</Button></div>
      ) : (
        <div className="mx-auto grid max-w-[1160px] grid-cols-2 gap-3">
          <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel [&>h2]:mt-0 [&>h2]:mb-3 [&>h2]:font-heading [&>h2]:text-base">
            <h2>{t("backup.repository")}</h2>
            <dl className="m-0 grid grid-cols-2 gap-3 [&_dd]:mt-1 [&_dd]:mb-0 [&_dd]:font-semibold [&_div]:border-b [&_div]:border-line [&_div]:pb-2 [&_dt]:text-xs [&_dt]:tracking-[.08em] [&_dt]:text-muted [&_dt]:uppercase"><div><dt>{t("backup.branch")}</dt><dd>{status.branch || "—"}</dd></div><div><dt>{t("backup.changes")}</dt><dd>{status.changes.length}</dd></div><div><dt>{t("backup.aheadBehind")}</dt><dd>{status.ahead} / {status.behind}</dd></div><div><dt>{t("backup.lastSync")}</dt><dd>{status.lastSync ? new Date(status.lastSync).toLocaleString() : t("common.never")}</dd></div></dl>
            {status.conflicts.length > 0 && <div className="my-2.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] px-3 py-2 text-danger"><strong>{t("backup.conflicts")}</strong>{status.conflicts.map((conflict) => <code className="my-1 block text-xs" key={conflict}>{conflict}</code>)}</div>}
          </section>
          <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel [&>h2]:mt-0 [&>h2]:mb-3 [&>h2]:font-heading [&>h2]:text-base [&>label]:mb-2.5 [&>label]:grid [&>label]:gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
            <h2>{t("backup.remote")}</h2>
            <label>{t("backup.remoteUrl")}<Input value={remote} onChange={(event) => setRemote(event.target.value)} placeholder="https://github.com/owner/tasks.git" /></label>
            <Button variant="outline" onClick={() => action("git_set_remote", { url: remote })}>{t("backup.saveRemote")}</Button>
            <p className="text-xs leading-normal text-muted">{t("backup.credentialHelp")}</p>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel [&>h2]:mt-0 [&>h2]:mb-3 [&>h2]:font-heading [&>h2]:text-base [&>label]:mb-2.5 [&>label]:grid [&>label]:gap-1.5 [&>label]:text-xs [&>label]:font-semibold [&>label]:text-muted">
            <h2>{t("backup.sync")}</h2>
            <label>{t("backup.commitMessage")}<Input value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <div className="flex gap-1.5"><Button onClick={() => action("git_commit", { message })}>{t("backup.commit")}</Button><Button variant="outline" onClick={() => action("git_pull")}>{t("backup.pull")}</Button><Button variant="outline" onClick={() => action("git_push")}>{t("backup.push")}</Button></div>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel [&>h2]:mt-0 [&>h2]:mb-3 [&>h2]:font-heading [&>h2]:text-base"><h2>{t("backup.history")}</h2>{history.length ? history.map((entry) => <code className="my-1 block text-xs" key={entry}>{entry}</code>) : <p className="text-muted">{t("backup.noCommits")}</p>}</section>
        </div>
      )}
    </div>
  );
}

function updateMessage(phase: ReturnType<typeof useUpdater>["phase"], version: string | undefined, t: ReturnType<typeof useTaskmateI18n>["t"]) {
  if (phase === "disabled") return t("updates.disabled");
  if (phase === "checking") return t("updates.checking");
  if (phase === "current") return t("updates.current");
  if (phase === "available") return t("updates.available", { version: version ?? "" });
  if (phase === "downloading") return t("updates.downloading");
  if (phase === "ready" || phase === "restarting") return t("updates.ready");
  if (phase === "error") return t("updates.error");
  return t("updates.description");
}

function UpdateContents({ body }: { body: string | null | undefined }) {
  const { locale, t } = useTaskmateI18n();
  const notes = useMemo(() => localizeUpdateNotes(body, locale), [body, locale]);
  if (!notes) return null;
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface-soft p-3">
      <h3 className="m-0 mb-2 text-sm font-semibold">{t("updates.contents")}</h3>
      <div className="max-h-52 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted select-text">{notes}</div>
    </section>
  );
}

function SettingsView({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { locale, setLocale, t } = useTaskmateI18n();
  const message = updateMessage(updater.phase, updater.info?.version, t);
  return (
    <div className="h-full overflow-auto px-8 pt-7 pb-12">
      <div className="mx-auto mb-5 flex max-w-[1160px] items-end justify-between gap-4"><div><p className="m-0 mb-1 text-xs font-bold tracking-[.12em] text-muted uppercase">{t("updates.eyebrow")}</p><h1 className="m-0 mb-1 font-heading text-[28px] tracking-[-.035em]">{t("nav.settings")}</h1><p className="m-0 text-muted">{t("settings.description")}</p></div></div>
      <div className="mx-auto grid max-w-[1160px] gap-4">
        <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="m-0 mb-1 font-heading text-base">{t("nav.language")}</h2><p className="m-0 text-sm text-muted">{t("settings.languageDescription")}</p></div>
            <Select className="min-w-36" ariaLabel={t("nav.language")} value={locale} onValueChange={(value) => setLocale(value as typeof locale)} options={[{ value: "en", label: "English" }, { value: "zh-CN", label: "简体中文" }]} />
          </div>
        </section>
        <EditorShortcutSettings />
        <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel">
          <h2 className="m-0 mb-3 font-heading text-base">{t("updates.title")}</h2>
          <div className="mb-3 flex items-center gap-2 text-muted"><Download size={20} /><p className="m-0">{message}</p></div>
          {updater.phase === "available" ? <UpdateContents body={updater.info?.body} /> : null}
          {updater.phase === "downloading" ? <Progress className="mb-3 w-[min(360px,100%)]" value={updater.progress.percent} /> : null}
          <div className="mt-3 flex gap-1.5">
            <Button variant="outline" disabled={updater.phase === "checking" || updater.phase === "disabled"} onClick={() => void updater.checkForUpdate()}>{updater.phase === "error" ? t("updates.retry") : t("updates.check")}</Button>
            {updater.phase === "available" ? <Button onClick={() => void updater.downloadAndInstall()}>{t("updates.install")}</Button> : null}
            {updater.phase === "ready" ? <Button onClick={() => void updater.restart()}>{t("updates.restart")}</Button> : null}
          </div>
          {updater.error ? <p role="alert" className="my-2.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] px-3 py-2 text-danger">{updater.error}</p> : null}
        </section>
      </div>
    </div>
  );
}

function SidebarUpdateAction({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { t } = useTaskmateI18n();
  const version = updater.info?.version;
  if (updater.phase === "available" && version) {
    const label = t("updates.navAvailable", { version });
    return (
      <Tooltip label={label}>
        <span><Button className="shadow-[0_4px_12px_color-mix(in_srgb,var(--accent)_35%,transparent)]" size="icon" aria-label={label} onClick={() => void updater.downloadAndInstall()}><Download size={18} /></Button></span>
      </Tooltip>
    );
  }
  if (updater.phase === "downloading") {
    const percent = updater.progress.percent;
    const label = percent === null ? t("updates.navDownloading") : t("updates.navDownloadingPercent", { percent });
    return (
      <Tooltip label={label}>
        <span><Button variant="outline" size="icon" aria-label={label} disabled>{percent === null ? <LoaderCircle className="animate-spin" size={18} /> : <span aria-hidden="true" className="text-[10px] tabular-nums">{percent}%</span>}</Button></span>
      </Tooltip>
    );
  }
  if (updater.phase === "ready") {
    const label = t("updates.navRestart");
    return (
      <Tooltip label={label}>
        <span><Button size="icon" aria-label={label} onClick={() => void updater.restart()}><RotateCcw size={18} /></Button></span>
      </Tooltip>
    );
  }
  if (updater.phase === "error" && version) {
    const label = t("updates.navRetry", { version });
    return (
      <Tooltip label={label}>
        <span><Button variant="destructive" size="icon" aria-label={label} onClick={() => void updater.downloadAndInstall()}><Download size={18} /></Button></span>
      </Tooltip>
    );
  }
  return null;
}

function WorkspaceSession() {
  const { locale, t } = useTaskmateI18n();
  const updater = useUpdater();
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
  const [propertiesWidth, setPropertiesWidth] = useState(loadTaskPropertiesWidth);
  const [compactCards, setCompactCards] = useState(() => localStorage.getItem(COMPACT_CARDS_KEY) === "true");
  const [taskListVisible, setTaskListVisible] = useState(() => localStorage.getItem(TASK_LIST_VISIBLE_KEY) !== "false");
  const [taskPanel, setTaskPanel] = useState<"files" | "search">(loadTaskPanel);
  const [searchResults, setSearchResults] = useState<TaskSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchEpoch, setSearchEpoch] = useState(0);
  const searchRequest = useRef(0);
  const externalTask = useWorkspaceState((state) => state.externalTask);
  const setExternalTask = useWorkspaceState((state) => state.setExternalTask);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [detailNarrow, setDetailNarrow] = useState(false);
  const [propertiesDrawerOpen, setPropertiesDrawerOpen] = useState(false);
  const fileSignal = useWorkspaceState((state) => state.fileSignal);
  const setFileSignal = useWorkspaceState((state) => state.setFileSignal);
  const [detailPanel, setDetailPanel] = useState<HTMLElement | null>(null);
  const propertiesButton = useRef<HTMLButtonElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const activeTab = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);
  const [restoringWorkspace, setRestoringWorkspace] = useState(recentWorkspaces.length > 0);
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
      setQuery({ search: "", archived: false, ...loadFilterSort(path) });
      setWorkspaceOpen(true);
      navigate("/tasks", { replace: true });
      if (snapshot.tasks[0]) {
        const first = await api.getTask(snapshot.tasks[0].id);
        setTask(first);
        setOpenTabs([{ kind: "task", id: first.id, title: first.title, fileName: first.fileName, archived: first.archived }]);
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
    void openWorkspace(recentWorkspaces[0]).finally(() => setRestoringWorkspace(false));
  }, [openWorkspace, recentWorkspaces]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("taskmate-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    localStorage.setItem(COMPACT_CARDS_KEY, String(compactCards));
    localStorage.setItem(TASK_LIST_VISIBLE_KEY, String(taskListVisible));
    localStorage.setItem(TASK_PANEL_KEY, taskPanel);
    localStorage.setItem(TASK_SEARCH_KEY, searchDraft);
  }, [compactCards, searchDraft, taskListVisible, taskPanel]);

  useEffect(() => {
    if (!workspaceOpen) return;
    saveFilterSort(workspacePath, query);
  }, [query.filters, query.sorts, workspaceOpen, workspacePath]);

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
    const request = ++searchRequest.current;
    if (!workspaceOpen || taskPanel !== "search" || !searchDraft.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void api.searchTasks(searchDraft).then((results) => {
        if (request === searchRequest.current) setSearchResults(results);
      }).catch((cause) => {
        if (request === searchRequest.current) setError(errorMessage(cause));
      }).finally(() => {
        if (request === searchRequest.current) setSearchLoading(false);
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [fileSignal, searchDraft, searchEpoch, taskPanel, workspaceOpen, workspacePath]);

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
      setOpenTabs((tabs) => tabs.map((tab) => tab.kind === "task" && tab.id === saved.id ? { kind: "task", id: saved.id, title: saved.title, fileName: saved.fileName, archived: saved.archived } : tab));
      setSaveState("saved");
      await refresh();
      setSearchEpoch((epoch) => epoch + 1);
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
  }, [fileSignal, refresh, saveState, task?.contentHash, task?.id]);

  const editTask = (patch: Partial<Task>) => {
    setTask((current) => current ? { ...current, ...patch } : current);
    if (patch.title !== undefined && task) {
      setOpenTabs((tabs) => tabs.map((tab) => tab.kind === "task" && tab.id === task.id ? { ...tab, title: patch.title! } : tab));
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
  const copyTaskFilePath = async (current: Pick<Task, "archived" | "fileName">) => {
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
      setOpenTabs((tabs) => tabs.some((tab) => tab.kind === "task" && tab.id === next.id) ? tabs : [...tabs, { kind: "task", id: next.id, title: next.title, fileName: next.fileName, archived: next.archived }]);
      setSaveState("saved");
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const create = async () => {
    try {
      const created = await api.createTask(t("tasks.untitled"));
      setTask(created);
      setOpenTabs((tabs) => [...tabs, { kind: "task", id: created.id, title: created.title, fileName: created.fileName, archived: created.archived }]);
      setSaveState("saved");
      await refresh();
      setSearchEpoch((epoch) => epoch + 1);
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const quickEdit = async (summary: TaskSummary, key: string, value: unknown) => {
    try {
      const full = summary.id === task?.id ? task : await api.getTask(summary.id);
      const saved = await api.saveTask({ ...full, properties: { ...full.properties, [key]: value } });
      if (saved.id === task?.id) setTask(saved);
      await refresh();
      setSearchEpoch((epoch) => epoch + 1);
    } catch (cause) { setError(`Quick edit failed: ${errorMessage(cause)}`); }
  };
  const createPropertyOption = useCallback(async (definition: PropertyDefinition, label: string): Promise<PropertyOption> => {
    try {
      const option = await api.createPropertyOption(definition.id, label);
      setDefinitions((current) => current.map((item) => item.id !== definition.id || item.options.some((candidate) => candidate.id === option.id) ? item : { ...item, options: [...item.options, option] }));
      return option;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, []);
  const archive = async () => {
    if (!task) return;
    const archivedId = task.id;
    await save({ ...task, archived: !task.archived });
    setTask(null);
    setOpenTabs((tabs) => tabs.filter((tab) => tab.kind !== "task" || tab.id !== archivedId));
  };
  const archiveTabTask = async (tab: Extract<OpenTab, { kind: "task" }>) => {
    if (task?.id === tab.id) {
      await archive();
      return;
    }
    try {
      const current = await api.getTask(tab.id);
      await api.saveTask({ ...current, archived: !current.archived });
      setOpenTabs((tabs) => tabs.filter((candidate) => tabKey(candidate) !== tabKey(tab)));
      await refresh();
      setSearchEpoch((epoch) => epoch + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const tabKey = (tab: OpenTab) => `${tab.kind}:${tab.id}`;
  const tabTitle = (tab: OpenTab) => tab.kind === "task" ? tab.title : t(tab.id === "/properties" ? "nav.properties" : tab.id === "/backup" ? "nav.backup" : "nav.settings");
  const activeTabKey = page === "/tasks" ? (selectedId ? `task:${selectedId}` : "") : `page:${page}`;
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabKey]);
  const closeTabs = async (closing: OpenTab[], preferred?: OpenTab) => {
    const closingKeys = new Set(closing.map(tabKey));
    if (task && closingKeys.has(`task:${task.id}`) && saveState === "dirty") await save(task);
    const firstClosingIndex = openTabs.findIndex((tab) => closingKeys.has(tabKey(tab)));
    const remaining = openTabs.filter((tab) => !closingKeys.has(tabKey(tab)));
    setOpenTabs(remaining);
    if (!closingKeys.has(activeTabKey)) return;
    const next = preferred && remaining.some((tab) => tabKey(tab) === tabKey(preferred))
      ? preferred
      : remaining[Math.min(firstClosingIndex, remaining.length - 1)];
    if (!next) {
      setTask(null);
      navigate("/tasks");
      return;
    }
    if (next.kind === "page") {
      navigate(next.id);
      return;
    }
    try {
      navigate("/tasks");
      setTask(await api.getTask(next.id));
      setSaveState("saved");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  const closeTab = (closing: OpenTab) => closeTabs([closing]);
  const openPage = (nextPage: WorkspacePage) => {
    setOpenTabs((tabs) => tabs.some((tab) => tab.kind === "page" && tab.id === nextPage) ? tabs : [...tabs, { kind: "page", id: nextPage }]);
  };

  const switchWorkspace = async () => {
    if (task && saveState === "dirty") await save(task);
    setTask(null);
    setOpenTabs([]);
    setWorkspaceOpen(false);
    navigate("/", { replace: true });
  };

  const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).at(-1) || workspacePath;
  const filterDefinitions = useMemo(() => definitions.filter((definition) => definition.enableFilter), [definitions]);
  const sortDefinitions = useMemo(() => definitions.filter((definition) => definition.enableSort), [definitions]);
  const detailDefinitions = useMemo(() => definitions.filter((definition) => definition.showInDetail).sort((a, b) => a.order - b.order), [definitions]);
  const filterSortActive = query.filters.length > 0 || query.sorts.length > 0;
  const updateFilters = (definition: PropertyDefinition, filters: TaskFilter[]) => {
    const without = query.filters.filter((filter) => filter.key !== definition.key);
    setQuery({ ...query, filters: [...without, ...filters] });
  };
  const sortOptions = [
    { value: "title:asc", label: t("tasks.sortTitle") },
    ...sortDefinitions.flatMap((definition) => [
      { value: `${definition.key}:asc`, label: `${localizedPropertyName(definition, locale)} · ${t("filter.asc")}` },
      { value: `${definition.key}:desc`, label: `${localizedPropertyName(definition, locale)} · ${t("filter.desc")}` },
    ]),
  ];
  const updateSort = (index: number, sort: TaskSort) => setQuery({ ...query, sorts: query.sorts.map((item, itemIndex) => itemIndex === index ? sort : item) });
  const moveSort = (index: number, offset: -1 | 1) => {
    const sorts = query.sorts.slice();
    [sorts[index], sorts[index + offset]] = [sorts[index + offset], sorts[index]];
    setQuery({ ...query, sorts });
  };
  const beginTaskListResize = (event: React.PointerEvent) => {
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
  const beginTaskPropertiesResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const width = propertiesWidth;
    const previousUserSelect = document.body.style.userSelect;
    let resizedWidth = width;
    document.body.style.userSelect = "none";
    const move = (moveEvent: PointerEvent) => {
      resizedWidth = Math.max(240, Math.min(520, width + start - moveEvent.clientX));
      setPropertiesWidth(resizedWidth);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.userSelect = previousUserSelect;
      localStorage.setItem(TASK_PROPERTIES_WIDTH_KEY, String(resizedWidth));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const selectTask = useLatestCallback((summary: TaskSummary) => void chooseTask(summary.id));
  const quickEditTask = useLatestCallback((summary: TaskSummary, key: string, value: unknown) => void quickEdit(summary, key, value));
  const changeTaskProperty = useLatestCallback(editProperty);
  const changeTaskBody = useLatestCallback((body: string) => editTask({ body }));
  const taskListEmptyState = useMemo(() => (
    <div className="flex h-full flex-col items-center justify-center text-center text-muted [&>h2]:mt-3 [&>h2]:mb-[3px] [&>h2]:font-heading [&>h2]:text-base [&>h2]:text-foreground [&>p]:m-0 [&>p]:text-xs">
      <LayoutList />
      <h2>{query.filters.length ? t("tasks.noMatches") : t("tasks.nothing")}</h2>
      <p>{query.archived ? t("tasks.archivedHint") : t("tasks.createHint")}</p>
    </div>
  ), [query.archived, query.filters.length, t]);

  if (!workspaceOpen) {
    if (restoringWorkspace) {
      return (
        <main className="grid h-full place-items-center bg-background">
          <LoaderCircle className="animate-spin text-accent" aria-hidden="true" />
        </main>
      );
    }
    return (
      <main className="flex h-full flex-col items-center justify-center bg-background text-center">
        <div className="grid size-[58px] place-items-center rounded-xl bg-accent text-white"><Check /></div>
        <p className="m-0 mt-3 mb-1 text-xs font-bold tracking-[.12em] text-muted uppercase">{t("app.tagline")}</p>
        <h1 className="m-0 mb-1 font-heading text-6xl font-bold tracking-[-.04em]">{t("app.name")}</h1>
        <p className="m-0 mb-5 max-w-[480px] text-muted">{t("app.description")}</p>
        <label className="w-[min(540px,70vw)] text-left text-xs font-semibold text-muted" htmlFor="workspace-path">{t("workspace.folder")}</label>
        <div className="my-1.5 mb-2.5 flex w-[min(540px,70vw)] gap-1.5">
          <Input className="h-[38px] w-full" id="workspace-path" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void openWorkspace(); }} />
          {api.supportsNativeFolderPicker() ? (
            <Button variant="outline" className="h-[38px] shrink-0" onClick={() => void chooseWorkspaceFolder()} disabled={loading}>
              <FolderOpen />{t("workspace.chooseFolder")}
            </Button>
          ) : null}
        </div>
        <Button size="lg" onClick={() => void openWorkspace()} disabled={loading || !workspacePath.trim()}>{loading ? <LoaderCircle className="animate-spin" /> : <Database />}{t("workspace.open")}</Button>
        {recentWorkspaces.length > 0 ? (
          <section className="mt-5 w-full max-w-md">
            <p className="mb-1.5 text-xs font-semibold text-[var(--muted)]">{t("workspace.recent")}</p>
            <div className="grid gap-1.5">
              {recentWorkspaces.map((path) => (
                <Button key={path} variant="outline" className="w-full justify-start overflow-hidden" onClick={() => void openWorkspace(path)}>
                  <FolderSync size={16} className="shrink-0" /><span className="truncate">{path}</span>
                </Button>
              ))}
            </div>
          </section>
        ) : null}
        {error && <div className="my-2.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] px-3 py-2 text-danger">{error}</div>}
      </main>
    );
  }

  if (page !== "/tasks" && page !== "/properties" && page !== "/backup" && page !== "/settings") {
    return <Navigate to="/tasks" replace />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="flex h-10 shrink-0 items-stretch border-b border-[var(--line)] bg-[var(--surface)] pl-[78px]" data-tauri-drag-region="deep">
        {page === "/tasks" ? (
          <div className="flex shrink-0 items-stretch">
            {taskListVisible ? (
              <>
                <Tooltip label={t("tasks.files")}>
                  <Button variant="ghost" size="icon" className="my-1 shrink-0" aria-label={t("tasks.files")} aria-pressed={taskPanel === "files"} aria-controls="task-side-panel" onClick={() => setTaskPanel("files")}><FileText size={17} /></Button>
                </Tooltip>
                <Tooltip label={t("tasks.searchPanel")}>
                  <Button variant="ghost" size="icon" className="my-1 shrink-0" aria-label={t("tasks.searchPanel")} aria-pressed={taskPanel === "search"} aria-controls="task-side-panel" onClick={() => setTaskPanel("search")}><Search size={17} /></Button>
                </Tooltip>
              </>
            ) : null}
            <Tooltip label={taskListVisible ? t("tasks.collapse") : t("tasks.expand")}>
              <Button variant="ghost" size="icon" className="my-1 shrink-0" aria-label={taskListVisible ? t("tasks.collapse") : t("tasks.expand")} aria-expanded={taskListVisible} aria-controls="task-side-panel" onClick={() => setTaskListVisible((visible) => !visible)}>
                {taskListVisible ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
              </Button>
            </Tooltip>
          </div>
        ) : null}
        <div className="scrollbar-hidden flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-1.5 pt-1" role="tablist" aria-label={t("editor.openFiles")}>
          {openTabs.map((tab, index) => (
            <ContextMenu.Root key={tabKey(tab)}>
              <ContextMenu.Trigger asChild>
                <div
                  ref={tabKey(tab) === activeTabKey ? activeTab : undefined}
                  className={cn("group flex h-8 min-w-32 max-w-56 shrink-0 items-center rounded-t-md border border-b-0 px-2 text-xs", tabKey(tab) === activeTabKey ? "border-line bg-background text-foreground" : "border-transparent text-muted hover:bg-surface-soft")}
                  role="tab"
                  aria-selected={tabKey(tab) === activeTabKey}
                >
                  <button className="min-w-0 flex-1 cursor-pointer truncate text-left" onClick={() => tab.kind === "task" ? (navigate("/tasks"), void chooseTask(tab.id)) : navigate(tab.id)}>{tabTitle(tab)}</button>
                  <button className="ml-1.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded opacity-0 hover:bg-line group-hover:opacity-100 focus:opacity-100" aria-label={`${t("tasks.closeTab")}: ${tabTitle(tab)}`} onClick={() => void closeTab(tab)}><X size={12} /></button>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="z-[200] w-[180px] rounded-lg border border-line bg-surface p-1 shadow-[0_12px_30px_rgba(0,0,0,.14)]" collisionPadding={8}>
                  <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void closeTab(tab)}>{t("tabs.close")}</ContextMenu.Item>
                  <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center rounded-[5px] px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" disabled={openTabs.length === 1} onSelect={() => void closeTabs(openTabs.filter((candidate) => tabKey(candidate) !== tabKey(tab)), tab)}>{t("tabs.closeOthers")}</ContextMenu.Item>
                  <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center rounded-[5px] px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" disabled={index === openTabs.length - 1} onSelect={() => void closeTabs(openTabs.slice(index + 1), tab)}>{t("tabs.closeAfter")}</ContextMenu.Item>
                  <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void closeTabs(openTabs)}>{t("tabs.closeAll")}</ContextMenu.Item>
                  {tab.kind === "task" ? <>
                    <ContextMenu.Separator className="m-1 h-px bg-line" />
                    <ContextMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-bold tracking-[.06em] text-muted uppercase">{t("editor.moreActions")}</ContextMenu.Label>
                    <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void archiveTabTask(tab)}>
                      {tab.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                      {tab.archived ? t("tasks.restore") : t("tasks.archiveAction")}
                    </ContextMenu.Item>
                    <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void copyText(tab.title)}>
                      <Copy size={15} />
                      {t("editor.copyTitle")}
                    </ContextMenu.Item>
                    <ContextMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void copyTaskFilePath(tab)}>
                      <FileText size={15} />
                      {t("editor.copyFilePath")}
                    </ContextMenu.Item>
                  </> : null}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-12 shrink-0 flex-col items-center border-r border-[var(--line)] bg-[var(--surface)] py-2">
          <div className="mb-3 grid size-7 place-items-center rounded-lg bg-[var(--accent)] text-white"><Check size={15} /></div>
          <nav className="grid gap-0.5" aria-label={t("nav.application")}>
            <Tooltip label={t("nav.tasks")}><NavLink to="/tasks" aria-label={t("nav.tasks")} aria-pressed={page === "/tasks"} className={buttonVariants({ variant: "ghost", size: "icon" })}><LayoutList size={18} /></NavLink></Tooltip>
            <Tooltip label={t("nav.properties")}><NavLink to="/properties" onClick={() => openPage("/properties")} aria-label={t("nav.properties")} aria-pressed={page === "/properties"} className={buttonVariants({ variant: "ghost", size: "icon" })}><Settings2 size={18} /></NavLink></Tooltip>
            <Tooltip label={t("nav.backup")}><NavLink to="/backup" onClick={() => openPage("/backup")} aria-label={t("nav.backup")} aria-pressed={page === "/backup"} className={buttonVariants({ variant: "ghost", size: "icon" })}><GitBranch size={18} /></NavLink></Tooltip>
            <Tooltip label={t("nav.settings")}><NavLink to="/settings" onClick={() => openPage("/settings")} aria-label={t("nav.settings")} aria-pressed={page === "/settings"} className={buttonVariants({ variant: "ghost", size: "icon" })}><Settings2 size={18} /></NavLink></Tooltip>
          </nav>
          <div className="mt-auto grid gap-0.5">
            <SidebarUpdateAction updater={updater} />
            <DropdownMenu.Root>
              <Tooltip label={t("workspace.switch")}>
                <DropdownMenu.Trigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("workspace.switch")}><FolderSync size={18} /></Button>
                </DropdownMenu.Trigger>
              </Tooltip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="z-[200] w-[min(320px,calc(100vw-80px))] rounded-lg border border-line bg-surface p-[5px] shadow-[0_12px_30px_rgba(0,0,0,.14)]" side="right" align="end" sideOffset={8} collisionPadding={8}>
                  <DropdownMenu.Label className="px-2 pt-1.5 pb-0.5 text-xs font-bold tracking-[.06em] text-muted uppercase">{t("workspace.current")}</DropdownMenu.Label>
                  <div className="min-w-0 px-2 pt-0.5 pb-1.5">
                    <span className="block truncate text-xs font-semibold">{workspaceName}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted" title={workspacePath}>{workspacePath}</span>
                  </div>
                  <DropdownMenu.Separator className="m-1 h-px bg-line" />
                  <DropdownMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void switchWorkspace()}>
                    <FolderSync size={16} />
                    {t("workspace.switch")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Tooltip label={t("nav.theme")}><Button variant="ghost" size="icon" aria-label={t("nav.theme")} onClick={() => setDark((value) => !value)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</Button></Tooltip>
          </div>
        </aside>
        <main className="relative h-full min-w-0 flex-1">
        {error && <div className="fixed top-3 right-4 z-50 flex max-w-[430px] items-center gap-2.5 rounded-[9px] bg-[#9f3e3b] py-2 pr-2 pl-3 text-xs text-white shadow-panel" role="alert"><span>{error}</span><Button variant="ghost" size="icon" className="text-white" aria-label={t("common.close")} onClick={() => setError("")}><X size={16} /></Button></div>}
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
        {page === "/settings" && <SettingsView updater={updater} />}
        {page === "/tasks" && (
          <>
            <Dialog
              open={filterDialogOpen}
              onOpenChange={setFilterDialogOpen}
              title={t("tasks.filterSort")}
              description={t("tasks.filterSortDescription")}
              closeLabel={t("common.close")}
              returnFocusRef={filterButton}
              contentClassName="w-[min(560px,calc(100vw-48px))]"
            >
              <div className="grid gap-4">
                <div className="grid gap-2">
                  {filterDefinitions.map((definition) => <DynamicFilter key={definition.id} definition={definition} current={query.filters.filter((filter) => filter.key === definition.key)} onChange={(filters) => updateFilters(definition, filters)} />)}
                </div>
                <div className="grid gap-2 border-t border-line pt-3">
                  {query.sorts.length === 0 ? <Select ariaLabel={`${t("properties.sort")} 1`} value="__recent" onValueChange={(value) => {
                    if (value === "__recent") return;
                    const [key, direction] = value.split(":");
                    setQuery({ ...query, sorts: [{ key, direction: direction as "asc" | "desc", nulls: "last" }] });
                  }} options={[{ value: "__recent", label: t("tasks.sortRecent") }, ...sortOptions]} /> : query.sorts.map((sort, index) => {
                    const usedKeys = new Set(query.sorts.filter((_, itemIndex) => itemIndex !== index).map((item) => item.key));
                    return <div className="flex items-center gap-1.5" key={`${sort.key}-${index}`}>
                      <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted">{index + 1}</span>
                      <Select className="min-w-0 flex-1" ariaLabel={`${t("properties.sort")} ${index + 1}`} value={`${sort.key}:${sort.direction}`} onValueChange={(value) => {
                        const [key, direction] = value.split(":");
                        updateSort(index, { key, direction: direction as "asc" | "desc", nulls: "last" });
                      }} options={sortOptions.filter((option) => !usedKeys.has(option.value.split(":")[0]))} />
                      {sort.key !== "title" ? <Select ariaLabel={index === 0 ? t("tasks.emptyLast") : `${t("tasks.emptyLast")} ${index + 1}`} value={sort.nulls} onValueChange={(value) => updateSort(index, { ...sort, nulls: value as "first" | "last" })} options={[{ value: "last", label: t("tasks.emptyLast") }, { value: "first", label: t("tasks.emptyFirst") }]} /> : null}
                      <Button variant="ghost" size="icon" aria-label={t("tasks.moveSortUp", { index: index + 1 })} disabled={index === 0} onClick={() => moveSort(index, -1)}><ChevronUp size={15} /></Button>
                      <Button variant="ghost" size="icon" aria-label={t("tasks.moveSortDown", { index: index + 1 })} disabled={index === query.sorts.length - 1} onClick={() => moveSort(index, 1)}><ChevronDown size={15} /></Button>
                      <Button variant="ghost" size="icon" className="text-danger" aria-label={t("tasks.removeSort", { index: index + 1 })} onClick={() => setQuery({ ...query, sorts: query.sorts.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={15} /></Button>
                    </div>;
                  })}
                  {query.sorts.length > 0 ? <Button variant="outline" className="justify-self-start" disabled={new Set(query.sorts.map((sort) => sort.key)).size >= new Set(sortOptions.map((option) => option.value.split(":")[0])).size} onClick={() => {
                    const usedKeys = new Set(query.sorts.map((sort) => sort.key));
                    const option = sortOptions.find((candidate) => !usedKeys.has(candidate.value.split(":")[0]));
                    if (!option) return;
                    const [key, direction] = option.value.split(":");
                    setQuery({ ...query, sorts: [...query.sorts, { key, direction: direction as "asc" | "desc", nulls: "last" }] });
                  }}><Plus size={15} />{t("tasks.addSort")}</Button> : null}
                </div>
              </div>
            </Dialog>
            <div className="grid h-full min-h-0" data-testid="split-layout" style={{ gridTemplateColumns: taskListVisible ? `${leftWidth}px 5px minmax(0, 1fr)` : "0 0 minmax(0, 1fr)" }}>
              <section id="task-side-panel" className={cn("flex min-h-0 min-w-0 flex-col bg-background", !taskListVisible && "invisible overflow-hidden")} aria-hidden={!taskListVisible}>
                {taskPanel === "files" ? <>
                <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-2.5 py-2" role="toolbar" aria-label={t("tasks.listToolbar")}>
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted [&_svg]:shrink-0" aria-label={t("tasks.taskCount", { count: tasks.length })}><LayoutList size={16} />{tasks.length}</span>
                  <div className="flex items-center gap-1.5 [&_button]:size-8 [&_button]:shrink-0 [&_button_svg]:size-[17px]">
                    <Tooltip label={t("tasks.openFilterSort")}>
                      <Button ref={filterButton} variant="outline" size="icon" aria-pressed={filterSortActive} aria-label={t("tasks.openFilterSort")} onClick={() => setFilterDialogOpen(true)}><ListFilter size={17} /></Button>
                    </Tooltip>
                    <Tooltip label={compactCards ? t("tasks.comfortable") : t("tasks.compact")}>
                      <Button variant="outline" size="icon" aria-pressed={compactCards} aria-label={compactCards ? t("tasks.comfortable") : t("tasks.compact")} onClick={() => setCompactCards((compact) => !compact)}><Rows3 size={17} /></Button>
                    </Tooltip>
                    <Tooltip label={query.archived ? t("tasks.returnActive") : t("tasks.archive")}>
                      <Button variant="outline" size="icon" aria-pressed={query.archived} aria-label={query.archived ? t("tasks.returnActive") : t("tasks.archive")} onClick={() => { setTask(null); setQuery({ ...query, archived: !query.archived }); }}>{query.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</Button>
                    </Tooltip>
                    <Tooltip label={t("tasks.new")}>
                      <Button size="icon" aria-label={t("tasks.new")} onClick={create}><Plus size={17} /></Button>
                    </Tooltip>
                  </div>
                </div>
                <TaskList
                  tasks={tasks}
                  definitions={definitions}
                  selectedId={selectedId}
                  compact={compactCards}
                  emptyState={taskListEmptyState}
                  onSelect={selectTask}
                  onQuickEdit={quickEditTask}
                  onCreateOption={createPropertyOption}
                />
                </> : <TaskSearchPanel search={searchDraft} results={searchResults} loading={searchLoading} onSearchChange={setSearchDraft} onSelect={(result) => void chooseTask(result.id)} />}
              </section>
              <div className={cn("relative z-[2] cursor-col-resize bg-line hover:bg-accent", !taskListVisible && "invisible")} data-testid="splitter" onPointerDown={beginTaskListResize} />
              <section className="min-h-0 min-w-0 bg-surface" ref={setDetailPanel}>
                {!task ? <div className="flex h-full flex-col items-center justify-center text-center text-muted [&>h2]:mt-3 [&>h2]:mb-[3px] [&>h2]:font-heading [&>h2]:text-base [&>h2]:text-foreground [&>p]:m-0 [&>p]:text-xs"><div className="grid size-[52px] place-items-center rounded-full bg-accent-soft text-accent"><Check /></div><h2>{t("tasks.select")}</h2><p>{t("tasks.selectHint")}</p></div> : (
                  <div className="flex h-full flex-col overflow-hidden">
                    <header className="z-[5] flex h-10 shrink-0 items-center gap-1 border-b border-line bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] py-1 pr-2 pl-3 backdrop-blur-xl" data-testid="detail-header">
                      <Input className="min-h-0 min-w-20 flex-1 rounded-none border-0 bg-transparent p-0 font-heading text-lg font-[730] tracking-[-.025em] shadow-none ring-0 focus:ring-0" aria-label={t("tasks.title")} value={task.title} onChange={(event) => editTask({ title: event.target.value })} />
                      <DropdownMenu.Root>
                        <Tooltip label={t("editor.moreActions")}>
                          <DropdownMenu.Trigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 shrink-0 [&_svg]:size-[17px]" aria-label={t("editor.moreActions")}><MoreHorizontal /></Button>
                          </DropdownMenu.Trigger>
                        </Tooltip>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className="z-[200] w-[180px] rounded-lg border border-line bg-surface p-1 shadow-[0_12px_30px_rgba(0,0,0,.14)]" align="end" sideOffset={5} collisionPadding={8}>
                            <DropdownMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void archive()}>
                              {task.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                              {task.archived ? t("tasks.restore") : t("tasks.archiveAction")}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void copyText(task.title)}>
                              <Copy size={15} />
                              {t("editor.copyTitle")}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="flex min-h-[30px] cursor-default items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent" onSelect={() => void copyTaskFilePath(task)}>
                              <FileText size={15} />
                              {t("editor.copyFilePath")}
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                      <SaveBadge state={saveState} />
                      {detailNarrow ? (
                        <Tooltip label={t("editor.openProperties")}>
                          <Button ref={propertiesButton} variant="outline" size="icon" className="size-8 shrink-0 [&_svg]:size-[17px]" aria-label={t("editor.openProperties")} onClick={() => setPropertiesDrawerOpen(true)}><Settings2 /></Button>
                        </Tooltip>
                      ) : null}
                    </header>
                    <div
                      className="grid min-h-0 flex-1 overflow-hidden"
                      data-testid="detail-split-layout"
                      style={{ gridTemplateColumns: !detailNarrow ? `minmax(0, 1fr) 5px ${propertiesWidth}px` : "minmax(0, 1fr)" }}
                    >
                      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                        <Suspense fallback={<div className="flex min-h-[370px] items-center justify-center gap-2 text-muted"><LoaderCircle className="animate-spin" />{t("editor.loading")}</div>}>
                          <MarkdownEditor value={task.body} onChange={changeTaskBody} />
                        </Suspense>
                      </div>
                      {!detailNarrow ? (
                        <>
                          <div className="relative z-[2] cursor-col-resize bg-line hover:bg-accent" data-testid="properties-splitter" onPointerDown={beginTaskPropertiesResize} />
                          <aside className="min-h-0 min-w-0 overflow-hidden">
                            <TaskProperties definitions={detailDefinitions} task={task} onChange={changeTaskProperty} onCreateOption={createPropertyOption} />
                          </aside>
                        </>
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
          {task ? <TaskProperties definitions={detailDefinitions} task={task} onChange={changeTaskProperty} onCreateOption={createPropertyOption} showHeading={false} /> : null}
        </Dialog>
        <Dialog
          open={Boolean(externalTask && task)}
          onOpenChange={(open) => { if (!open) setExternalTask(null); }}
          title={t("external.title", { title: task?.title ?? "" })}
          description={t("external.description")}
          closeLabel={t("common.close")}
          footer={<><Button variant="outline" onClick={() => { setExternalTask(null); setSaveState("dirty"); }}>{t("external.keep")}</Button><Button onClick={() => { if (externalTask) setTask(externalTask); setExternalTask(null); setSaveState("saved"); }}>{t("external.reload")}</Button></>}
        >
          {externalTask && task ? <div className="grid grid-cols-2 gap-2.5 [&_pre]:max-h-80 [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-soft [&_pre]:p-3 [&_pre]:text-xs"><div><strong>{t("external.editor")}</strong><pre>{task.body}</pre></div><div><strong>{t("external.disk")}</strong><pre>{externalTask.body}</pre></div></div> : null}
        </Dialog>
      </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <TaskmateI18nProvider>
      <HashRouter useTransitions={false}>
        <WorkspaceStoreProvider>
          <Routes><Route path="*" element={<WorkspaceSession />} /></Routes>
        </WorkspaceStoreProvider>
      </HashRouter>
    </TaskmateI18nProvider>
  );
}
