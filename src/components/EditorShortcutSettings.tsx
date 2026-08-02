import { useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  EDITOR_SHORTCUT_ACTIONS,
  captureShortcut,
  formatShortcut,
  getEditorShortcuts,
  getShortcutPlatform,
  resetEditorShortcuts,
  setEditorShortcut,
  subscribeEditorShortcuts,
  validateShortcut,
  type MarkdownShortcutAction,
} from "../lib/editor-shortcuts";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { Button } from "./ui/Button";

export function EditorShortcutSettings() {
  const { t } = useTaskmateI18n();
  const shortcuts = useSyncExternalStore(subscribeEditorShortcuts, getEditorShortcuts, getEditorShortcuts);
  const [recording, setRecording] = useState<MarkdownShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const platform = getShortcutPlatform();

  const recordShortcut = (action: MarkdownShortcutAction, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const captured = captureShortcut(event.nativeEvent, platform);
    if (captured.type === "pending") return;
    if (captured.type === "cancel") {
      setRecording(null);
      setError(null);
      return;
    }
    if (captured.type === "invalid") {
      setError(t("settings.shortcuts.invalid"));
      return;
    }
    const validationError = validateShortcut(captured.shortcut, shortcuts, action, platform);
    if (validationError) {
      setError(t(`settings.shortcuts.${validationError}`));
      return;
    }
    setEditorShortcut(action, captured.shortcut);
    setRecording(null);
    setError(null);
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="m-0 mb-1 font-heading text-base">{t("settings.shortcuts.title")}</h2>
          <p className="m-0 text-sm text-muted">{t("settings.shortcuts.description")}</p>
        </div>
        <Button variant="outline" onClick={() => {
          resetEditorShortcuts();
          setRecording(null);
          setError(null);
        }}>{t("settings.shortcuts.restore")}</Button>
      </div>
      <div className="divide-y divide-line">
        {EDITOR_SHORTCUT_ACTIONS.map((action) => {
          const shortcut = shortcuts[action];
          const actionLabel = t(`settings.shortcuts.${action}`);
          return (
            <div className="flex min-h-12 items-center justify-between gap-4 py-2" key={action}>
              <span className="text-sm font-medium">{actionLabel}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="min-w-32 font-mono"
                  aria-label={t("settings.shortcuts.change", { action: actionLabel })}
                  onClick={() => {
                    setRecording(action);
                    setError(null);
                  }}
                  onBlur={() => {
                    setRecording((current) => current === action ? null : current);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (recording === action) recordShortcut(action, event);
                  }}
                >
                  {recording === action
                    ? t("settings.shortcuts.recording")
                    : shortcut ? formatShortcut(shortcut, platform) : t("settings.shortcuts.unassigned")}
                </Button>
                <Button variant="ghost" disabled={shortcut === null} onClick={() => {
                  setEditorShortcut(action, null);
                  setRecording(null);
                  setError(null);
                }}>{t("settings.shortcuts.clear")}</Button>
              </div>
            </div>
          );
        })}
      </div>
      {error ? <p role="alert" className="m-0 mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
