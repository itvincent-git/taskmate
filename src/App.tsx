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
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { Input } from "./components/ui/Input";
import { Select } from "./components/ui/Select";
import { Tooltip } from "./components/ui/Tooltip";
import { TaskmateI18nProvider, localizedPropertyName, useTaskmateI18n } from "./lib/taskmate-i18n";
import "./styles.css";

const initialPath = localStorage.getItem("taskmate-workspace") || `${navigator.platform.includes("Mac") ? "/Users/Shared" : "."}/Taskmate`;
const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

function TaskmateApp() {
  const { locale, setLocale, t } = useTaskmateI18n();
  const [workspacePath, setWorkspacePath] = useState(initialPath);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<AppView>("tasks");
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
  const [lockedPropertyIds, setLockedPropertyIds] = useState<Set<string>>(new Set());
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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
      setLockedPropertyIds(new Set(snapshot.properties.map((definition) => definition.id)));
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
      const created = await api.createTask(t("tasks.untitled"));
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
      setError(t("tasks.archiveBeforeDelete"));
      return;
    }
    setDeleteConfirmOpen(true);
  };
  const confirmDelete = async () => {
    if (!task) return;
    try {
      await api.deleteTask(task.id);
      setTask(null);
      setDeleteConfirmOpen(false);
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
        <div className="welcome-language"><Select ariaLabel={t("nav.language")} value={locale} onValueChange={(value) => setLocale(value as typeof locale)} options={[{ value: "en", label: "English" }, { value: "zh-CN", label: "简体中文" }]} /></div>
        <p className="eyebrow">{t("app.tagline")}</p>
        <h1>{t("app.name")}</h1>
        <p>{t("app.description")}</p>
        <label>{t("workspace.folder")}<Input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void openWorkspace(); }} /></label>
        <Button size="lg" onClick={openWorkspace} disabled={loading || !workspacePath.trim()}>{loading ? <LoaderCircle className="spin" /> : <Database />}{t("workspace.open")}</Button>
        {error && <div className="banner error">{error}</div>}
      </main>
    );
  }

  return (
    <div className="app">
      <header className="app-nav">
        <div className="nav-brand"><span><Check size={16} /></span><strong>{t("app.name")}</strong></div>
        <nav aria-label={t("nav.application")}>
          <Button variant="ghost" className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}><LayoutList size={17} />{t("nav.tasks")}</Button>
          <Button variant="ghost" className={view === "properties" ? "active" : ""} onClick={() => setView("properties")}><Settings2 size={17} />{t("nav.properties")}</Button>
          <Button variant="ghost" className={view === "backup" ? "active" : ""} onClick={() => setView("backup")}><GitBranch size={17} />{t("nav.backup")}</Button>
        </nav>
        <div className="nav-actions">
          <Select ariaLabel={t("nav.language")} value={locale} onValueChange={(value) => setLocale(value as typeof locale)} options={[{ value: "en", label: "EN" }, { value: "zh-CN", label: "中文" }]} />
          <Tooltip label={t("nav.theme")}><Button variant="ghost" size="icon" aria-label={t("nav.theme")} onClick={() => setDark((value) => !value)}>{dark ? <Sun /> : <Moon />}</Button></Tooltip>
        </div>
      </header>
      <main className="workspace">
        {error && <div className="toast" role="alert"><span>{error}</span><Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={() => setError("")}>×</Button></div>}
        {view === "properties" && <PropertySettings definitions={definitions} lockedIds={lockedPropertyIds} onChange={setDefinitions} saving={schemaSaving} onRebuild={async () => {
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
        {view === "backup" && <BackupView />}
        {view === "tasks" && (
          <>
            <header className="topbar">
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
              <Button variant="outline" className={query.archived ? "active" : ""} onClick={() => { setTask(null); setQuery({ ...query, archived: !query.archived }); }}>{query.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{query.archived ? t("tasks.active") : t("tasks.archive")}</Button>
              <Button onClick={create}><Plus size={17} />{t("tasks.new")}</Button>
            </header>
            <div className="split-layout" style={{ gridTemplateColumns: `${leftWidth}px 5px minmax(0, 1fr)` }}>
              <section className="task-list-panel">
                <div className="list-heading"><div><p className="eyebrow">{query.archived ? t("tasks.archive") : t("tasks.workspace")}</p><h1>{query.archived ? t("tasks.archived") : t("tasks.myTasks")}</h1></div><span>{tasks.length}</span></div>
                <div className="task-list" ref={listHost}>
                  {tasks.length === 0 ? <div className="list-empty"><LayoutList /><h2>{searchDraft || query.filters.length ? t("tasks.noMatches") : t("tasks.nothing")}</h2><p>{query.archived ? t("tasks.archivedHint") : t("tasks.createHint")}</p></div> : (
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
                {!task ? <div className="detail-empty"><div className="empty-illustration"><Check /></div><h2>{t("tasks.select")}</h2><p>{t("tasks.selectHint")}</p></div> : (
                  <div className="detail-scroll">
                    <header className="detail-header">
                      <div className="title-block">
                        <Input className="title-input" aria-label={t("tasks.title")} value={task.title} onChange={(event) => editTask({ title: event.target.value })} />
                        <div className="file-name">{task.fileName}</div>
                      </div>
                      {statusDefinition && <PropertyInput definition={statusDefinition} value={task.properties[statusDefinition.key]} onChange={(value) => editProperty(statusDefinition.key, value)} />}
                      <SaveBadge state={saveState} />
                      <Tooltip label={task.archived ? t("tasks.restore") : t("tasks.archiveAction")}><Button variant="ghost" size="icon" aria-label={task.archived ? t("tasks.restore") : t("tasks.archiveAction")} onClick={() => void archive()}>{task.archived ? <ArchiveRestore /> : <Archive />}</Button></Tooltip>
                      <Tooltip label={t("tasks.deleteAction")}><Button variant="ghost" size="icon" className="danger" aria-label={t("tasks.deleteAction")} onClick={() => void remove()}><Trash2 /></Button></Tooltip>
                    </header>
                    <Suspense fallback={<div className="editor-loading"><LoaderCircle className="spin" />{t("editor.loading")}</div>}>
                      <MarkdownEditor value={task.body} onChange={(body) => editTask({ body })} />
                    </Suspense>
                    <section className="property-panel">
                      <div className="section-title"><h2>{t("editor.properties")}</h2><span>{t("editor.frontmatter")}</span></div>
                      <div className="property-grid">
                        {detailDefinitions.map((definition) => (
                          <label key={definition.id}><span>{localizedPropertyName(definition, locale)}{definition.required && <em>*</em>}</span><PropertyInput definition={definition} value={task.properties[definition.key]} onChange={(value) => editProperty(definition.key, value)} /></label>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        <Dialog
          open={Boolean(externalTask && task)}
          onOpenChange={(open) => { if (!open) setExternalTask(null); }}
          title={t("external.title", { title: task?.title ?? "" })}
          description={t("external.description")}
          footer={<><Button variant="outline" onClick={() => { setExternalTask(null); setSaveState("dirty"); }}>{t("external.keep")}</Button><Button onClick={() => { if (externalTask) setTask(externalTask); setExternalTask(null); setSaveState("saved"); }}>{t("external.reload")}</Button></>}
        >
          {externalTask && task ? <div className="diff-grid"><div><strong>{t("external.editor")}</strong><pre>{task.body}</pre></div><div><strong>{t("external.disk")}</strong><pre>{externalTask.body}</pre></div></div> : null}
        </Dialog>
        <Dialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title={t("tasks.deleteAction")}
          description={t("tasks.deleteConfirm", { title: task?.title ?? "" })}
          footer={<><Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>{t("common.cancel")}</Button><Button variant="destructive" onClick={() => void confirmDelete()}>{t("common.delete")}</Button></>}
        />
      </main>
    </div>
  );
}

export function App() {
  return <TaskmateI18nProvider><TaskmateApp /></TaskmateI18nProvider>;
}
