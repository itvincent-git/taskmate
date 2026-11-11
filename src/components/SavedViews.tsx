import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Save } from "lucide-react";
import type { PropertyDefinition, SavedViewsSnapshot, SavedWorkView, TaskFolder, TaskQuery, WorkViewQuery } from "../types";
import { api } from "../lib/api";
import { invalidViewReference, sameWorkViewQuery, viewNameError, workViewQuery } from "../lib/saved-views";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Tooltip } from "./ui/Tooltip";

type ViewDialog = { kind: "create" } | { kind: "manage" } | { kind: "rename"; view: SavedWorkView } | { kind: "delete"; view: SavedWorkView };

export function SavedViews({ workspacePath, query, activeId, onActiveIdChange, onApply, definitions, folders }: {
  workspacePath: string;
  query: TaskQuery;
  activeId: string | null;
  onActiveIdChange(id: string | null): void;
  onApply(query: WorkViewQuery): void;
  definitions: PropertyDefinition[];
  folders: TaskFolder[];
}) {
  const { t } = useTaskmateI18n();
  const [snapshot, setSnapshot] = useState<SavedViewsSnapshot>({ views: [], contentHash: null });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<ViewDialog | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const generation = useRef(0);
  const alive = useRef(false);
  const loadFailed = useRef(false);
  const active = snapshot.views.find((view) => view.id === activeId);
  const modified = active && !sameWorkViewQuery(query, active);
  const actionButton = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await api.loadViews(workspacePath);
      if (!alive.current || request !== generation.current) return;
      setSnapshot(next); setReady(true);
      if (loadFailed.current) { setError(""); loadFailed.current = false; }
    } catch (cause) {
      if (!alive.current || request !== generation.current) return;
      setReady(false);
      loadFailed.current = true;
      setError(String(cause instanceof Error ? cause.message : cause));
    }
  }, [workspacePath]);

  useEffect(() => {
    alive.current = true;
    void reload();
    let dispose: (() => void) | undefined;
    void api.onViewsFileChange(workspacePath, () => { void reload(); }).then((unlisten) => {
      if (alive.current) dispose = unlisten; else unlisten();
    });
    return () => { alive.current = false; generation.current++; dispose?.(); };
  }, [reload, workspacePath]);

  const checkQuery = (value: WorkViewQuery | TaskQuery) => {
    const invalid = invalidViewReference(value, definitions, folders);
    if (!invalid) return true;
    setError(t(`views.invalid.${invalid.kind}`, { value: invalid.value }));
    return false;
  };

  const persist = async (views: SavedWorkView[], nextId?: string): Promise<boolean> => {
    if (busyRef.current || !ready) return false;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const next = await api.saveViews(workspacePath, views, snapshot.contentHash);
      if (!alive.current) return false;
      generation.current++;
      setSnapshot(next);
      if (nextId !== undefined) onActiveIdChange(nextId);
      return true;
    } catch (cause) {
      if (!alive.current) return false;
      const message = String(cause instanceof Error ? cause.message : cause);
      setError(message.includes("VIEWS_CONFLICT") ? t("views.conflict") : message);
      // Re-read before allowing any subsequent write; preserve the current query.
      setReady(false);
      await reload();
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const apply = (view: SavedWorkView) => {
    if (!checkQuery(view)) return;
    onApply(structuredClone(workViewQuery(view)));
    onActiveIdChange(view.id);
    setError("");
  };
  const update = async (view: SavedWorkView) => {
    if (!checkQuery(query)) return;
    await persist(snapshot.views.map((item) => item.id === view.id ? { ...view, ...workViewQuery(query) } : item), view.id);
  };
  const openNameDialog = (view?: SavedWorkView) => {
    setName(view?.name ?? ""); setNameError("");
    setDialog(view ? { kind: "rename", view } : { kind: "create" });
  };
  const submitName = async () => {
    if (!dialog || (dialog.kind !== "create" && dialog.kind !== "rename")) return;
    const problem = viewNameError(name, snapshot.views, dialog.kind === "rename" ? dialog.view.id : undefined);
    if (problem) { setNameError(t(`views.name.${problem}`)); return; }
    if (dialog.kind === "create") {
      if (!checkQuery(query)) return;
      const view = { ...workViewQuery(query), id: crypto.randomUUID(), name: name.trim() };
      if (await persist([...snapshot.views, view], view.id)) setDialog(null);
    } else {
      if (await persist(snapshot.views.map((view) => view.id === dialog.view.id ? { ...view, name: name.trim() } : view))) setDialog({ kind: "manage" });
    }
  };

  return <div className="min-w-0 shrink-0 border-b border-line px-2.5 pb-2">
    <div className="flex min-w-0 items-center gap-1.5">
      <Select className="min-w-0 flex-1" ariaLabel={t("views.label")} disabled={!ready || busy} value={active ? `view:${active.id}` : "__custom"} onValueChange={(id) => {
        if (id === "__custom") { onActiveIdChange(null); return; }
        const view = snapshot.views.find((item) => `view:${item.id}` === id);
        if (view) apply(view);
      }} options={[
        { value: "__custom", label: t("views.custom") },
        ...snapshot.views.map((view) => ({ value: `view:${view.id}`, label: <span className="block max-w-[min(360px,60vw)] truncate" title={view.name}>{view.name}{modified && active?.id === view.id ? ` · ${t("views.modified")}` : ""}</span> })),
      ]} />
      <Tooltip label={t("views.saveAs")}><Button variant="outline" size="icon" aria-label={t("views.saveAs")} disabled={!ready || busy} onClick={() => openNameDialog()}><Save size={15} /></Button></Tooltip>
      <Tooltip label={t("views.manage")}><Button ref={actionButton} variant="ghost" size="icon" aria-label={t("views.manage")} onClick={() => setDialog({ kind: "manage" })}><MoreHorizontal size={16} /></Button></Tooltip>
    </div>
    {modified && <div className="mt-1 flex flex-wrap items-center gap-1" aria-live="polite">
      <span className="text-xs text-muted">{t("views.modified")}</span>
      <Button className="h-7 px-1.5 text-xs" variant="ghost" disabled={!ready || busy} onClick={() => void update(active)}>{t("views.update")}</Button>
      <Button className="h-7 px-1.5 text-xs" variant="ghost" disabled={!ready || busy} onClick={() => openNameDialog()}>{t("views.saveCopy")}</Button>
      <Button className="h-7 px-1.5 text-xs" variant="ghost" disabled={!ready || busy} onClick={() => apply(active)}>{t("views.restore")}</Button>
    </div>}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }} title={dialog?.kind === "delete" ? t("views.delete") : dialog?.kind === "rename" ? t("views.rename") : dialog?.kind === "create" ? t("views.saveAs") : t("views.manage")} closeLabel={t("common.close")} returnFocusRef={actionButton} contentClassName="w-[min(520px,calc(100vw-40px))]">
      {dialog?.kind === "manage" && <div className="grid gap-2">
        {!snapshot.views.length && <p className="text-sm text-muted">{t("views.empty")}</p>}
        {snapshot.views.map((view) => <div className="min-w-0 rounded-md border border-line p-2" key={view.id}>
          <span className="block truncate text-sm font-semibold" title={view.name}>{view.name}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            <Button variant="ghost" disabled={!ready || busy} onClick={() => openNameDialog(view)} aria-label={`${t("views.rename")}: ${view.name}`}>{t("views.rename")}</Button>
            <Button variant="ghost" disabled={!ready || busy} onClick={() => void update(view)} aria-label={`${t("views.replace")}: ${view.name}`}>{t("views.replace")}</Button>
            <Button variant="ghost" className="text-danger" disabled={!ready || busy} onClick={() => setDialog({ kind: "delete", view })} aria-label={`${t("views.delete")}: ${view.name}`}>{t("views.delete")}</Button>
          </div>
        </div>)}
      </div>}
      {(dialog?.kind === "create" || dialog?.kind === "rename") && <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submitName(); }}>
        <label className="grid gap-1 text-sm">{t("views.name")}<Input autoFocus value={name} aria-invalid={!!nameError} aria-describedby={nameError ? "view-name-error" : undefined} onChange={(event) => { setName(event.target.value); setNameError(""); }} /></label>
        {nameError && <p role="alert" id="view-name-error" className="text-sm text-danger">{nameError}</p>}
        <Button type="submit" disabled={!ready || busy}>{busy ? t("common.saving") : t("common.save")}</Button>
      </form>}
      {dialog?.kind === "delete" && <>
        <p className="break-words text-sm">{t("views.deleteConfirm", { name: dialog.view.name })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setDialog({ kind: "manage" })}>{t("common.cancel")}</Button>
          <Button disabled={!ready || busy} onClick={() => void persist(snapshot.views.filter((view) => view.id !== dialog.view.id)).then((ok) => {
            if (!ok) return;
            if (activeId === dialog.view.id) onActiveIdChange(null);
            setDialog({ kind: "manage" });
          })}>{t("common.delete")}</Button>
        </div>
      </>}
      {dialog && error && <p role="alert" className="mt-3 break-words text-xs text-danger">{error}</p>}
      {dialog && !ready && <Button variant="outline" className="mt-2" disabled={busy} onClick={() => void reload()}>{t("views.reload")}</Button>}
    </Dialog>
    {!dialog && error && <div role="alert" className="mt-1 break-words text-xs text-danger">{error}<Button variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => void reload()}>{t("views.reload")}</Button></div>}
  </div>;
}
