import { useState, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { getFontSettings, setFont, subscribeFontSettings, type FontTarget } from "../lib/font-settings";
import { useTaskmateI18n } from "../lib/taskmate-i18n";
import { Button } from "./ui/Button";

export function FontSettings() {
  const { t } = useTaskmateI18n();
  const fonts = useSyncExternalStore(subscribeFontSettings, getFontSettings, getFontSettings);
  const [picking, setPicking] = useState<FontTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseFont = async (target: FontTarget) => {
    setPicking(target);
    setError(null);
    try {
      const font = await api.pickSystemFont(fonts[target], t(`settings.fonts.${target}`), t("settings.fonts.pickerPrompt"));
      if (font) setFont(target, font);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPicking(null);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-panel">
      <div className="mb-3">
        <h2 className="m-0 mb-1 font-heading text-base">{t("settings.fonts.title")}</h2>
        <p className="m-0 text-sm text-muted">{t("settings.fonts.description")}</p>
      </div>
      <div className="divide-y divide-line">
        {(["interface", "editor"] as const).map((target) => (
          <div className="flex min-h-14 items-center justify-between gap-4 py-2" key={target}>
            <div className="min-w-0">
              <div className="text-sm font-medium">{t(`settings.fonts.${target}`)}</div>
              <div className="truncate text-xs text-muted" style={{ fontFamily: fonts[target] || undefined }}>
                {fonts[target] || t(target === "editor" ? "settings.fonts.followInterface" : "settings.fonts.default")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" disabled={picking !== null} onClick={() => void chooseFont(target)}>
                {picking === target ? t("settings.fonts.choosing") : t("settings.fonts.choose")}
              </Button>
              <Button variant="ghost" disabled={!fonts[target] || picking !== null} onClick={() => setFont(target, null)}>
                {t("settings.fonts.reset")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error ? <p role="alert" className="m-0 mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
