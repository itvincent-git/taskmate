import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Archive,
  ArchiveRestore,
  Check,
  Cloud,
  Database,
  GitBranch,
  LayoutList,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
} from "lucide-react";
import { api } from "./lib/api";
import type {
  AppView,
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
import { DynamicFilter } from "./components/DynamicFilter";
import "./styles.css";

const initialPath = localStorage.getItem("taskmate-workspace") || `${navigator.platform.includes("Mac") ? "/Users/Shared" : "."}/Taskmate`;
const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function SaveBadge({ state }: { state: SaveState }) {
  const content = {
    saved: [Check, "Saved"],
    dirty: [Cloud, "Unsaved"],
    saving: [LoaderCircle, "Saving…"],
    failed: [Cloud, "Save failed"],
    external: [Cloud, "External change"],
  } as const;
  const [Icon, label] = content[state];
  return <span className={`save-badge ${state}`}><Icon size={14} className={state === "saving" ? "spin" : ""} />{label}</span>;
}

function BackupView() {
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
      <div className="view-heading"><div><p className="eyebrow">Versioned backup</p><h1>Git & GitHub</h1><p>Task Markdown and workspace schema are versioned. The rebuildable SQLite index is ignored.</p></div></div>
      {error && <div className="banner error">{error}</div>}
      {!status?.initialized ? (
        <div className="empty-panel"><GitBranch size={38} /><h2>Initialize version history</h2><p>Create a Git repository inside this workspace.</p><button className="primary" onClick={() => action("git_initialize")} disabled={Boolean(busy)}>Initialize Git</button></div>
      ) : (
        <div className="backup-grid">
          <section className="settings-card">
            <h2>Repository</h2>
            <dl><div><dt>Branch</dt><dd>{status.branch || "—"}</dd></div><div><dt>Changes</dt><dd>{status.changes.length}</dd></div><div><dt>Ahead / behind</dt><dd>{status.ahead} / {status.behind}</dd></div><div><dt>Last sync</dt><dd>{status.lastCommit ? new Date(status.lastCommit).toLocaleString() : "Never"}</dd></div></dl>
            {status.conflicts.length > 0 && <div className="banner error"><strong>Sync stopped: conflicts</strong>{status.conflicts.map((conflict) => <code key={conflict}>{conflict}</code>)}</div>}
          </section>
          <section className="settings-card">
            <h2>GitHub remote</h2>
            <label>Remote URL<input value={remote} onChange={(event) => setRemote(event.target.value)} placeholder="https://github.com/owner/tasks.git" /></label>
            <button className="secondary" onClick={() => action("git_set_remote", { url: remote })}>Save remote</button>
            <p className="help">Credentials stay in your operating system’s Git credential manager. Tokens are rejected in remote URLs.</p>
          </section>
          <section className="settings-card">
            <h2>Sync</h2>
            <label>Commit message<input value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <div className="button-row"><button className="primary" onClick={() => action("git_commit", { message })}>Commit</button><button className="secondary" onClick={() => action("git_pull")}>Pull</button><button className="secondary" onClick={() => action("git_push")}>Push</button></div>
          </section>
          <section className="settings-card history"><h2>Recent history</h2>{history.length ? history.map((entry) => <code key={entry}>{entry}</code>) : <p className="muted">No commits yet.</p>}</section>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [workspacePath, setWorkspacePath] = useState(initialPath);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<AppView>("tasks");
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [query, setQuery] = useState<TaskQuery>({ search: "", archived: false, filters: [] });
  const [searchDraft, setSearchDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [schemaSaving, setSchemaSaving] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("taskmate-theme") === "dark");
  const [leftWidth, setLeftWidth] = useState(390);
  const [externalTask, setExternalTask] = useState<Task | null>(null);
  const [fileSignal, setFileSignal] = useState(0);
  const listHost = useRef<HTMLDivElement>(null);
  const selectedId = task?.id;

  const openWorkspace = async () => {
    setLoading(true);
    setError("");
    try {
      const snapshot = await api.openWorkspace(workspacePath.trim());
      localStorage.setItem("taskmate-workspace", workspacePath.trim());
      setDefinitions(snapshot.properties);
      setTasks(snapshot.tasks);
      setWorkspaceOpen(true);
      if (snapshot.tasks[0]) setTask(await api.getTask(snapshot.tasks[0].id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("taskmate-theme", dark ? "dark" : "light");
  }, [dark]);

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
    setSaveState("dirty");
  };
  const editProperty = (key: string, value: unknown) => editTask({ properties: { ...task?.properties, [key]: value } });
  const chooseTask = async (id: string) => {
    if (id === selectedId) return;
    if (task && saveState === "dirty") await save(task);
    try {
      setTask(await api.getTask(id));
      setSaveState("saved");
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const create = async () => {
    try {
      const created = await api.createTask();
      setTask(created);
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
    await save({ ...task, archived: !task.archived });
    setTask(null);
  };
  const remove = async () => {
    if (!task) return;
    if (!task.archived) {
      setError("Archive this task before deleting it.");
      return;
    }
    if (!window.confirm(`Move “${task.title}” to workspace trash?`)) return;
    try {
      await api.moveToTrash(task.id);
      setTask(null);
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
  };

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => listHost.current,
    estimateSize: () => 154,
    overscan: 6,
  });

  const statusDefinition = definitions.find((definition) => definition.role === "status");
  const filterDefinitions = definitions.filter((definition) => definition.enableFilter);
  const sortDefinitions = definitions.filter((definition) => definition.enableSort);
  const detailDefinitions = definitions.filter((definition) => definition.showInDetail).sort((a, b) => a.order - b.order);
  const updateFilters = (definition: PropertyDefinition, filters: TaskFilter[]) => {
    const without = query.filters.filter((filter) => filter.key !== definition.key);
    setQuery({ ...query, filters: [...without, ...filters] });
  };
  const beginResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const width = leftWidth;
    const move = (moveEvent: PointerEvent) => setLeftWidth(Math.max(290, Math.min(620, width + moveEvent.clientX - start)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  if (!workspaceOpen) {
    return (
      <main className="welcome">
        <div className="welcome-mark"><Check /></div>
        <p className="eyebrow">Local-first task management</p>
        <h1>Taskmate</h1>
        <p>Your tasks remain readable Markdown files. SQLite is only a fast, rebuildable index.</p>
        <label>Workspace folder<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void openWorkspace(); }} /></label>
        <button className="primary large" onClick={openWorkspace} disabled={loading || !workspacePath.trim()}>{loading ? <LoaderCircle className="spin" /> : <Database />} Open workspace</button>
        {error && <div className="banner error">{error}</div>}
      </main>
    );
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="logo"><Check size={18} /></div>
        <nav aria-label="Application">
          <button className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")} title="Tasks"><LayoutList /></button>
          <button className={view === "properties" ? "active" : ""} onClick={() => setView("properties")} title="Properties"><Settings2 /></button>
          <button className={view === "backup" ? "active" : ""} onClick={() => setView("backup")} title="Git backup"><GitBranch /></button>
        </nav>
        <button title="Toggle theme" onClick={() => setDark((value) => !value)}>{dark ? <Sun /> : <Moon />}</button>
      </aside>
      <main className="workspace">
        {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
        {view === "properties" && <PropertySettings definitions={definitions} onChange={setDefinitions} saving={schemaSaving} onRebuild={async () => {
          setSchemaSaving(true);
          try { setTasks(await api.rebuildIndex()); } catch (cause) { setError(errorMessage(cause)); } finally { setSchemaSaving(false); }
        }} onSave={async () => {
          setSchemaSaving(true);
          try { setDefinitions(await api.saveProperties(definitions)); } catch (cause) { setError(errorMessage(cause)); } finally { setSchemaSaving(false); }
        }} />}
        {view === "backup" && <BackupView />}
        {view === "tasks" && (
          <>
            <header className="topbar">
              <div className="search"><Search size={17} /><input aria-label="Search tasks" placeholder="Search tasks…" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></div>
              <div className="filters">
                {filterDefinitions.map((definition) => <DynamicFilter key={definition.id} definition={definition} current={query.filters.filter((filter) => filter.key === definition.key)} onChange={(filters) => updateFilters(definition, filters)} />)}
                <select aria-label="Sort tasks" value={query.sort ? `${query.sort.key}:${query.sort.direction}` : ""} onChange={(event) => {
                  const [key, direction] = event.target.value.split(":");
                  setQuery({ ...query, sort: key ? { key, direction: direction as "asc" | "desc", nulls: "last" } : undefined });
                }}>
                  <option value="">Recently updated</option>
                  <option value="title:asc">Title · A–Z</option>
                  {sortDefinitions.flatMap((definition) => [
                    <option key={`${definition.id}-asc`} value={`${definition.key}:asc`}>{definition.name} · Asc</option>,
                    <option key={`${definition.id}-desc`} value={`${definition.key}:desc`}>{definition.name} · Desc</option>,
                  ])}
                </select>
              </div>
              <button className={query.archived ? "secondary active" : "secondary"} onClick={() => { setTask(null); setQuery({ ...query, archived: !query.archived }); }}>{query.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{query.archived ? "Active" : "Archive"}</button>
              <button className="primary" onClick={create}><Plus size={17} /> New task</button>
            </header>
            <div className="split-layout" style={{ gridTemplateColumns: `${leftWidth}px 5px minmax(0, 1fr)` }}>
              <section className="task-list-panel">
                <div className="list-heading"><div><p className="eyebrow">{query.archived ? "Archive" : "Workspace"}</p><h1>{query.archived ? "Archived tasks" : "My tasks"}</h1></div><span>{tasks.length}</span></div>
                <div className="task-list" ref={listHost}>
                  {tasks.length === 0 ? <div className="list-empty"><LayoutList /><h2>{searchDraft || query.filters.length ? "No matching tasks" : "Nothing here yet"}</h2><p>{query.archived ? "Archived tasks appear here." : "Create a task to begin."}</p></div> : (
                    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                      {virtualizer.getVirtualItems().map((item) => {
                        const summary = tasks[item.index];
                        return <div key={summary.id} ref={virtualizer.measureElement} data-index={item.index} className="virtual-row" style={{ transform: `translateY(${item.start}px)` }}><TaskCard task={summary} selected={summary.id === selectedId} definitions={definitions} onSelect={() => void chooseTask(summary.id)} onQuickEdit={(key, value) => void quickEdit(summary, key, value)} /></div>;
                      })}
                    </div>
                  )}
                </div>
              </section>
              <div className="splitter" onPointerDown={beginResize} />
              <section className="detail-panel">
                {!task ? <div className="detail-empty"><div className="empty-illustration"><Check /></div><h2>Select a task</h2><p>Choose a card to edit its Markdown and properties.</p></div> : (
                  <div className="detail-scroll">
                    <header className="detail-header">
                      <div className="title-block">
                        <input className="title-input" aria-label="Task title" value={task.title} onChange={(event) => editTask({ title: event.target.value })} />
                        <div className="file-name">{task.fileName}</div>
                      </div>
                      {statusDefinition && <PropertyInput definition={statusDefinition} value={task.properties[statusDefinition.key]} onChange={(value) => editProperty(statusDefinition.key, value)} />}
                      <SaveBadge state={saveState} />
                      <button className="icon" title={task.archived ? "Restore task" : "Archive task"} onClick={() => void archive()}>{task.archived ? <ArchiveRestore /> : <Archive />}</button>
                      <button className="icon danger" title="Move to trash" onClick={() => void remove()}><Trash2 /></button>
                    </header>
                    <Suspense fallback={<div className="editor-loading"><LoaderCircle className="spin" /> Loading editor…</div>}>
                      <MarkdownEditor value={task.body} onChange={(body) => editTask({ body })} />
                    </Suspense>
                    <section className="property-panel">
                      <div className="section-title"><h2>Properties</h2><span>Frontmatter</span></div>
                      <div className="property-grid">
                        {detailDefinitions.map((definition) => (
                          <label key={definition.id}><span>{definition.name}{definition.required && <em>*</em>}</span><PropertyInput definition={definition} value={task.properties[definition.key]} onChange={(value) => editProperty(definition.key, value)} /></label>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {externalTask && task && (
          <div className="modal-backdrop">
            <div className="modal">
              <p className="eyebrow">External file change</p>
              <h2>“{task.title}” changed on disk</h2>
              <p>Taskmate will never overwrite either version silently. Compare them, then choose which version to continue editing.</p>
              <div className="diff-grid"><div><strong>Your editor</strong><pre>{task.body}</pre></div><div><strong>File on disk</strong><pre>{externalTask.body}</pre></div></div>
              <div className="button-row end"><button className="secondary" onClick={() => { setExternalTask(null); setSaveState("dirty"); }}>Keep editor version</button><button className="primary" onClick={() => { setTask(externalTask); setExternalTask(null); setSaveState("saved"); }}>Reload file</button></div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
