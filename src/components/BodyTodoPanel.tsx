import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { CheckSquare, ListFilter, LoaderCircle } from "lucide-react";
import { api } from "../lib/api";
import { localizedOptionLabel, useTaskmateI18n } from "../lib/taskmate-i18n";
import type { TodoDraftStore } from "../lib/todo-draft";
import { extractBodyTodos, type BodyTodo } from "../editor/bodyTodos";
import type { PropertyDefinition, SaveState, Task, TaskFolder, TaskQuery } from "../types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";

export interface TodoTarget { task: Task; item: BodyTodo }
export interface TodoUndo extends TodoTarget { checked: boolean }

interface Props {
  workspacePath: string;
  query: TaskQuery;
  folders: TaskFolder[];
  definitions: PropertyDefinition[];
  activeTask: Task | null;
  saveState: SaveState;
  draftStore: TodoDraftStore;
  refreshSignal: number;
  busy: boolean;
  onOpen(target: TodoTarget): Promise<void>;
  onToggle(target: TodoTarget, checked: boolean): Promise<TodoTarget | null>;
  onFilter(): void;
  onError(cause: unknown): void;
}

export const BodyTodoPanel = memo(function BodyTodoPanel({ workspacePath, query, folders, definitions, activeTask, saveState, draftStore, refreshSignal, busy, onOpen, onToggle, onFilter, onError }: Props) {
  const { locale } = useTaskmateI18n();
  const zh = locale === "zh-CN";
  const draft = useStore(draftStore);
  const deferredDraft = useDeferredValue(draft);
  const [documents, setDocuments] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const [scope, setScope] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeQuotes, setIncludeQuotes] = useState(false);
  const [undo, setUndo] = useState<TodoUndo | null>(null);
  const cache = useRef(new Map<string, { body: string; items: BodyTodo[] }>());
  const filters = query.filters;
  const sorts = query.sorts;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.queryTaskDocuments({ search: "", archived: false, folderPath: scope, filters, sorts }, includeArchived).then((result) => {
      if (!cancelled) {
        setDocuments(result);
        const ids = new Set(result.map((task) => task.id));
        for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id);
      }
    }).catch((cause) => { if (!cancelled) onError(cause); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspacePath, scope, includeArchived, filters, sorts, refreshSignal, onError]);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const groups = useMemo(() => documents.flatMap((saved) => {
    const current = activeTask?.id === saved.id ? activeTask : saved;
    const body = deferredDraft.id === current.id && deferredDraft.body ? deferredDraft.body.toString() : current.body;
    const task = { ...current, body };
    let entry = cache.current.get(task.id);
    if (!entry || entry.body !== body) {
      entry = { body, items: extractBodyTodos(body) };
      cache.current.set(task.id, entry);
    }
    const baseline = task.id === activeTask?.id && body !== saved.body ? extractBodyTodos(saved.body) : entry.items;
    const sections = new Map<string, { headings: string[]; items: { item: BodyTodo; pending: boolean }[] }>();
    for (const item of entry.items) {
      if (item.cancelled || (item.quoted && !includeQuotes)) continue;
      const pending = task.id === activeTask?.id && saveState !== "saved" && item.checked && !baseline.some((old) => old.checked && old.text === item.text && old.parent === item.parent && JSON.stringify(old.headings) === JSON.stringify(item.headings));
      const recent = undo?.task.id === task.id && undo.item.markerFrom === item.markerFrom && undo.item.text === item.text;
      if (item.checked && !showCompleted && !pending && !recent) continue;
      if (deferredSearch && ![item.text, item.details, item.parent, ...item.headings, task.title].join(" ").toLocaleLowerCase().includes(deferredSearch)) continue;
      const key = JSON.stringify(item.headings);
      if (!sections.has(key)) sections.set(key, { headings: item.headings, items: [] });
      sections.get(key)!.items.push({ item, pending });
    }
    return sections.size ? [{ task, sections: [...sections.values()] }] : [];
  }), [documents, activeTask, deferredDraft, saveState, includeQuotes, showCompleted, deferredSearch, undo]);
  const count = groups.reduce((total, group) => total + group.sections.reduce((n, section) => n + section.items.length, 0), 0);
  const folderPaths = [...new Set(folders.filter((folder) => includeArchived || !folder.archived).map((folder) => folder.path))].sort();
  const statusDefinition = definitions.find((definition) => definition.role === "status" || definition.key === "status");
  const statusLabel = (task: Task) => {
    const value = task.properties[statusDefinition?.key ?? "status"];
    const option = statusDefinition?.options.find((option) => option.id === value);
    return option ? localizedOptionLabel(option, locale) : String(value ?? "");
  };
  const toggle = async (target: TodoTarget, checked: boolean, previousChecked: boolean) => {
    const result = await onToggle(target, checked);
    if (result) {
      setDocuments((current) => current.map((task) => task.id === result.task.id ? result.task : task));
      setUndo({ ...result, checked: previousChecked });
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={zh ? "正文待办" : "Body todos"}>
      <div className="shrink-0 space-y-2 border-b border-line p-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-semibold"><CheckSquare size={16} />{zh ? "待办" : "Todos"}<span className="text-xs text-muted">{count}</span></h2>
          <Button variant="ghost" size="icon" aria-label={zh ? "待办筛选与排序" : "Todo filters and sorting"} aria-pressed={filters.length > 0 || sorts.length > 0} onClick={onFilter}><ListFilter size={15} /></Button>
        </div>
        <Input className="w-full" aria-label={zh ? "搜索待办" : "Search todos"} placeholder={zh ? "事项、文件或章节…" : "Item, file or heading…"} value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select className="w-full max-w-none" ariaLabel={zh ? "待办范围" : "Todo scope"} value={scope === null ? "__all" : scope === "" ? "__root" : scope} onValueChange={(value) => setScope(value === "__all" ? null : value === "__root" ? "" : value)} options={[
          { value: "__all", label: zh ? "整个工作区" : "Entire workspace" },
          { value: "__root", label: zh ? "根目录任务" : "Root tasks" },
          ...folderPaths.map((path) => ({ value: path, label: path })),
        ]} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          <label className="flex items-center gap-1"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />{zh ? "显示已完成" : "Show completed"}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />{zh ? "包含归档" : "Include archived"}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={includeQuotes} onChange={(event) => setIncludeQuotes(event.target.checked)} />{zh ? "包含引用清单" : "Include quoted lists"}</label>
        </div>
        {filters.length > 0 && <p className="m-0 text-[11px] text-muted">{zh ? "已应用任务属性筛选" : "Task property filters applied"}</p>}
        {sorts.length === 0 && <p className="m-0 text-[11px] text-muted">{zh ? "按任务最近修改，文件内按原文顺序" : "Recently modified tasks; source order within files"}</p>}
      </div>
      {undo && <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-2 text-xs" role="status"><span className="min-w-0 flex-1 truncate">{zh ? "已更新：" : "Updated: "}{undo.item.text}</span><button className="shrink-0 cursor-pointer font-semibold text-accent disabled:opacity-50" disabled={busy} onClick={async () => { const result = await onToggle(undo, undo.checked); if (result) { setDocuments((current) => current.map((task) => task.id === result.task.id ? result.task : task)); setUndo(null); } }}>{zh ? "撤销" : "Undo"}</button></div>}
      {loading && <div className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs text-muted" role="status"><LoaderCircle size={13} className="animate-spin" />{zh ? "更新待办…" : "Refreshing todos…"}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-2.5" aria-label={zh ? "待办列表" : "Todo list"}>
        {groups.length === 0 && !loading ? <div className="px-3 py-10 text-center text-xs leading-6 text-muted">{zh ? "当前范围没有匹配的未完成事项。正文中的 Markdown 勾选项会出现在这里。" : "No matching todos in this scope. Markdown checklist items appear here."}</div> : null}
        {groups.map(({ task, sections }) => <section className="mb-3 rounded-lg border border-line bg-surface" key={task.id} aria-label={task.title}>
          <div className="border-b border-line px-3 py-2">
            <div className="text-[10px] text-muted">{task.folderPath || "/"}{task.archived ? (zh ? " · 已归档" : " · Archived") : ""}</div>
            <div className="mt-0.5 text-sm font-semibold">{task.title}</div>
            <div className="mt-1 text-[10px] text-muted">{zh ? "任务状态：" : "Task status: "}{statusLabel(task)}{activeTask?.id === task.id && saveState !== "saved" ? (zh ? " · 未保存" : " · Unsaved") : ""}</div>
          </div>
          {sections.map((section, index) => <div key={index} className="px-3 py-2">
            {section.headings.length ? <div className="mb-2 text-[11px] leading-4 text-muted">{section.headings.join(" › ")}</div> : null}
            <ul className="m-0 list-none space-y-2 p-0">
              {section.items.map(({ item, pending }) => <li key={item.markerFrom} className="text-xs leading-5">
                {item.parent ? <div className="pl-6 text-[10px] text-muted">{item.parent}</div> : null}
                <div className="flex items-start gap-2">
                  <input className="mt-1 shrink-0" type="checkbox" aria-label={`${zh ? "完成事项" : "Complete todo"}: ${item.text}`} checked={item.checked && !pending} disabled={busy || (activeTask?.id === task.id && saveState === "external")} onChange={(event) => void toggle({ task, item }, event.target.checked, item.checked && !pending)} />
                  <button className={`min-w-0 flex-1 cursor-pointer text-left break-words hover:text-accent ${item.checked && !pending ? "text-muted line-through" : "text-foreground"}`} onClick={() => void onOpen({ task, item })}>{item.text}</button>
                </div>
                {item.quoted ? <span className="pl-6 text-[10px] text-muted">{zh ? "引用内容" : "Quoted content"}</span> : null}
                {pending ? <div className="pl-6 text-[10px] text-warning">{saveState === "failed" || saveState === "external" ? (zh ? "未保存成功，请重试或解决冲突" : "Not saved; retry or resolve the conflict") : (zh ? "等待保存" : "Awaiting save")}</div> : null}
                {item.details ? <details className="ml-6 text-[11px] text-muted"><summary className="cursor-pointer">{zh ? "补充说明" : "Details"}</summary><p className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words">{item.details}</p></details> : null}
              </li>)}
            </ul>
          </div>)}
        </section>)}
      </div>
    </section>
  );
});
