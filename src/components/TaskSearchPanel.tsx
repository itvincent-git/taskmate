import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, FileSearch, LoaderCircle, Search } from "lucide-react";
import type { TaskSearchResult } from "../types";
import { Input } from "./ui/Input";
import { useTaskmateI18n } from "../lib/taskmate-i18n";

function matchParts(text: string, search: string): ReactNode[] {
  const needle = Array.from(search.trim().toLocaleLowerCase());
  if (needle.length === 0) return [text];
  const original = Array.from(text);
  const folded: string[] = [];
  const sourceIndexes: number[] = [];
  original.forEach((character, index) => {
    for (const foldedCharacter of Array.from(character.toLocaleLowerCase())) {
      folded.push(foldedCharacter);
      sourceIndexes.push(index);
    }
  });
  const parts: ReactNode[] = [];
  let sourceCursor = 0;
  for (let index = 0; index <= folded.length - needle.length;) {
    const matches = needle.every((character, offset) => folded[index + offset] === character);
    if (!matches) {
      index += 1;
      continue;
    }
    const start = sourceIndexes[index];
    const end = sourceIndexes[index + needle.length - 1] + 1;
    if (start > sourceCursor) parts.push(original.slice(sourceCursor, start).join(""));
    parts.push(<mark key={`${start}-${end}`} className="rounded-sm bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-inherit">{original.slice(start, end).join("")}</mark>);
    sourceCursor = end;
    while (index < sourceIndexes.length && sourceIndexes[index] < end) index += 1;
  }
  if (sourceCursor < original.length) parts.push(original.slice(sourceCursor).join(""));
  return parts.length > 0 ? parts : [text];
}

export function TaskSearchPanel({ search, results, loading, onSearchChange, onSelect }: {
  search: string;
  results: TaskSearchResult[];
  loading: boolean;
  onSearchChange(search: string): void;
  onSelect(result: TaskSearchResult): void;
}) {
  const { t } = useTaskmateI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 6,
    getItemKey: (index) => results[index].id,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [results, virtualizer]);

  const empty = !search.trim() ? [FileSearch, t("tasks.searchPrompt"), t("tasks.searchHint")] as const
    : [Search, t("tasks.noSearchResults"), t("tasks.noSearchResultsHint")] as const;
  const [EmptyIcon, emptyTitle, emptyHint] = empty;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2.5">
        <div className="flex h-9 items-center rounded-xl border border-line bg-surface-soft px-2 text-muted focus-within:border-accent">
          {loading ? <LoaderCircle size={16} className="animate-spin" aria-label={t("tasks.searchLoading")} /> : <Search size={16} />}
          <Input className="min-w-0 flex-1 border-0 bg-transparent shadow-none ring-0 focus:ring-0" aria-label={t("tasks.search")} placeholder={t("tasks.search")} value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </div>
      </div>
      {results.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-muted">
          {loading ? <LoaderCircle className="animate-spin" /> : <EmptyIcon />}
          <h2 className="mt-3 mb-[3px] font-heading text-base text-foreground">{loading ? t("tasks.searchLoading") : emptyTitle}</h2>
          <p className="m-0 text-xs">{loading ? t("tasks.searchLoadingHint") : emptyHint}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5" aria-label={t("tasks.searchResults")}>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const result = results[item.index];
              return (
                <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="absolute top-0 left-0 w-full pb-2" style={{ transform: `translateY(${item.start}px)` }}>
                  <button className="w-full cursor-pointer rounded-lg border border-line bg-surface p-3 text-left hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] hover:bg-accent-soft" onClick={() => onSelect(result)}>
                    <span className="flex items-center gap-1.5 font-heading text-sm font-semibold text-foreground">
                      <span className="min-w-0 flex-1 truncate">{matchParts(result.title, search)}</span>
                      {result.archived ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-soft px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted"><Archive size={11} />{t("tasks.archived")}</span> : null}
                    </span>
                    <span className="block truncate text-[10px] text-muted">{result.folderPath || "/"}</span>
                    <span className="mt-1.5 block overflow-hidden text-xs leading-5 text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{matchParts(result.snippet, search)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
