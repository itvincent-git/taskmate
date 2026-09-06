import { Archive, FileText, History } from "lucide-react";
import type { RecentFile } from "../lib/recent-files";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { cn } from "../lib/utils";

export function RecentFilesPanel({ files, selectedId, onSelect }: {
  files: RecentFile[];
  selectedId?: string;
  onSelect(id: string): void;
}) {
  const { t } = useTaskmateI18n();
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("tasks.recentFiles")}>
      <h2 className="m-0 shrink-0 border-b border-line px-3 py-3 font-heading text-sm font-semibold">{t("tasks.recentFiles")}</h2>
      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted">
          <History />
          <h3 className="mt-3 mb-1 text-base text-foreground">{t("tasks.noRecentFiles")}</h3>
          <p className="m-0 text-xs">{t("tasks.recentFilesHint")}</p>
        </div>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none space-y-2 overflow-auto p-2.5">
          {files.map((file) => (
            <li key={file.id}>
              <button className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line p-3 text-left hover:bg-accent-soft", file.id === selectedId ? "border-accent bg-accent-soft" : "bg-surface")} aria-current={file.id === selectedId ? "true" : undefined} onClick={() => onSelect(file.id)} title={[file.folderPath, file.fileName].filter(Boolean).join("/")}>
                <FileText size={16} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{file.title}</span><span className="mt-1 block truncate text-xs text-muted">{[file.folderPath, file.fileName].filter(Boolean).join("/")}</span></span>
                {file.archived ? <Archive size={14} className="shrink-0 text-muted" aria-label={t("tasks.archived")} /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
