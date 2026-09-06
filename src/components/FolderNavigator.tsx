import { useEffect, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus, MoreHorizontal } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { TaskFolder } from "../types";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { useTaskmateI18n } from "../lib/taskmate-i18n";

export const TASK_DRAG_TYPE = "application/x-taskmate";
export type FolderAction = { kind: "create" | "move" | "delete"; source: string; parent: string; name: string };
export type DragPayload = { archived: boolean; ids?: string[]; folder?: string };
export function readTaskDrag(event: DragEvent): DragPayload | null {
  try {
    const value = JSON.parse(event.dataTransfer.getData(TASK_DRAG_TYPE));
    if (typeof value.archived !== "boolean") return null;
    if (Array.isArray(value.ids) && value.ids.length && value.ids.every((id: unknown) => typeof id === "string")) return value;
    if (typeof value.folder === "string" && value.folder) return value;
  } catch { /* Other applications use different drag formats. */ }
  return null;
}

export function FolderNavigator({ folders, archived, selected, expanded, onSelect, onExpand, onAction, onDrop, checked, onSelectAll, onMoveSelected, busy, revealSignal }: {
  folders: TaskFolder[]; archived: boolean; selected: string | null; expanded: string[];
  onSelect(path: string | null): void; onExpand(paths: string[]): void;
  onAction(action: FolderAction): Promise<boolean>; onDrop(payload: DragPayload, target: string): void;
  revealSignal?: number;
  checked: number; onSelectAll(): void; onMoveSelected(): void; busy: boolean;
}) {
  const { locale } = useTaskmateI18n();
  const label = (en: string, zh: string) => locale === "zh-CN" ? zh : en;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { if (revealSignal) setCollapsed(false); }, [revealSignal]);
  const [action, setAction] = useState<FolderAction | null>(null);
  const paths = folders.filter((f) => f.archived === archived).map((f) => f.path).sort((a, b) => a.localeCompare(b));
  const rootLabel = label("Root tasks", "根目录任务");
  const dropProps = (target: string) => ({
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes(TASK_DRAG_TYPE) && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } },
    onDrop: (event: DragEvent) => { event.preventDefault(); const payload = readTaskDrag(event); if (payload && payload.archived === archived && !busy) onDrop(payload, target); },
  });
  const itemClass = "block w-full rounded px-2 py-1.5 text-left text-xs outline-none data-[highlighted]:bg-accent-soft";
  return <>
    <section className="max-h-[40%] shrink-0 overflow-y-auto border-b border-line px-2 py-1" aria-label={label("Folders", "文件夹")}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{label("Folders", "文件夹")}</Button>
        <Button size="icon" variant="ghost" disabled={busy} aria-label={label("New folder", "新建文件夹")} onClick={() => setAction({ kind: "create", source: "", parent: selected || "", name: "" })}><FolderPlus size={15} /></Button>
      </div>
      {!collapsed && <nav className="text-xs">
        <button className="block w-full rounded px-2 py-1.5 text-left aria-[current=true]:bg-accent-soft" aria-current={selected === null} onClick={() => onSelect(null)}>{label("All tasks", "全部任务")}</button>
        <button {...dropProps("")} className="block w-full rounded px-2 py-1.5 text-left aria-[current=true]:bg-accent-soft" aria-current={selected === ""} onClick={() => onSelect("")}>{rootLabel}</button>
        {paths.filter((path) => path.split("/").slice(0, -1).every((_, i, parts) => expanded.includes(parts.slice(0, i + 1).join("/")))).map((path) => {
          const parent = path.split("/").slice(0, -1).join("/");
          const name = path.split("/").at(-1)!;
          const hasChildren = paths.some((p) => p.startsWith(path + "/"));
          return <div key={path} {...dropProps(path)} className="flex items-center rounded aria-[current=true]:bg-accent-soft" aria-current={selected === path} style={{ paddingLeft: (path.split("/").length - 1) * 14 }} draggable={!busy} onDragStart={(event) => { event.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify({ archived, folder: path })); event.dataTransfer.effectAllowed = "move"; }}>
            <button className="w-5 shrink-0" aria-label={`${label("Expand", "展开")} ${path}`} aria-expanded={hasChildren ? expanded.includes(path) : undefined} onClick={() => onExpand(expanded.includes(path) ? expanded.filter((p) => p !== path) : [...expanded, path])}>{hasChildren ? expanded.includes(path) ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <Folder size={12} />}</button>
            <button className="min-w-0 flex-1 truncate py-1.5 text-left" title={path} onClick={() => onSelect(path)}>{name}</button>
            <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="p-1" aria-label={`${label("Folder actions", "文件夹操作")} ${path}`}><MoreHorizontal size={14} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="z-[200] rounded border border-line bg-surface p-1 shadow-panel">
              <DropdownMenu.Item className={itemClass} onSelect={() => setAction({ kind: "create", source: "", parent: path, name: "" })}>{label("New subfolder", "新建子文件夹")}</DropdownMenu.Item>
              <DropdownMenu.Item className={itemClass} onSelect={() => setAction({ kind: "move", source: path, parent, name })}>{label("Rename / move folder", "重命名 / 移动文件夹")}</DropdownMenu.Item>
              <DropdownMenu.Item className={itemClass} onSelect={() => setAction({ kind: "delete", source: path, parent, name })}>{label("Delete empty folder", "删除空文件夹")}</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
          </div>;
        })}
      </nav>}
    </section>
    <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs">
      <button className="rounded px-2 py-1 hover:bg-accent-soft" onClick={onSelectAll}>{label("Select all results", "全选当前结果")}</button>
      <button className="ml-auto rounded px-2 py-1 hover:bg-accent-soft disabled:opacity-40" disabled={!checked || busy} onClick={onMoveSelected}>{label("Move to", "移动到")} · {checked}</button>
    </div>
    <Dialog open={!!action} onOpenChange={(open) => { if (!open && !busy) setAction(null); }} title={label("Manage folder", "管理文件夹")} contentClassName="w-[min(480px,calc(100vw-40px))]">
      {action && <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void onAction(action).then((ok) => { if (ok) setAction(null); }); }}>
        {action.kind === "delete" ? <p>{label("Only empty folders can be deleted", "仅可删除空文件夹")}: {action.source}</p> : <>
          <label>{label("Folder name", "文件夹名称")}<Input value={action.name} onChange={(e) => setAction({ ...action, name: e.target.value })} autoFocus /></label>
          <label>{label("Parent folder", "上级文件夹")}<select className="block w-full rounded border border-line bg-surface p-2" value={action.parent} onChange={(e) => setAction({ ...action, parent: e.target.value })}><option value="">{rootLabel}</option>{paths.filter((p) => action.kind !== "move" || (p !== action.source && !p.startsWith(action.source + "/"))).map((p) => <option key={p}>{p}</option>)}</select></label>
        </>}
        <Button type="submit" disabled={busy || (action.kind !== "delete" && !action.name)}>{label("Apply", "应用")}</Button>
      </form>}
    </Dialog>
  </>;
}
