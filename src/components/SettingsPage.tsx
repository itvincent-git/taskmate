import type { Language, UpdatePhase } from "../types";
import type { MessageKey } from "../lib/i18n";
import { useAutostart } from "../hooks/useAutostart";
import { useUpdater } from "../hooks/useUpdater";
import { Button } from "./ui/Button";
import { Card, CardHeader } from "./ui/Card";
import { Select } from "./ui/Select";

function updateMessage(phase: UpdatePhase, version: string | undefined, t: (key: MessageKey, values?: Record<string, string>) => string) {
  if (phase === "disabled") return t("updateDisabled");
  if (phase === "checking") return t("updateChecking");
  if (phase === "current") return t("updateCurrent");
  if (phase === "available") return t("updateAvailable", { version: version ?? "" });
  if (phase === "downloading") return t("updateDownloading");
  if (phase === "ready" || phase === "restarting") return t("updateReady");
  return t("updateIdle");
}

export function SettingsPage({
  language,
  setLanguage,
  t,
}: {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, values?: Record<string, string>) => string;
}) {
  const autostart = useAutostart();
  const updater = useUpdater();

  return (
    <div className="page-stack">
      <Card>
        <CardHeader title={t("language")} />
        <Select ariaLabel={t("language")} value={language} onValueChange={(value) => setLanguage(value as Language)} options={[{ value: "en", label: "English" }, { value: "zh", label: "简体中文" }]} />
      </Card>
      <Card>
        <div className="setting-row">
          <CardHeader title={t("autostart")} description={t("autostartHint")} />
          <label className="switch">
            <input
              aria-label={t("autostart")}
              type="checkbox"
              checked={autostart.enabled}
              disabled={autostart.busy}
              onChange={(event) => void autostart.toggle(event.currentTarget.checked)}
            />
            <span />
          </label>
        </div>
        {autostart.error ? <p role="alert" className="error">{autostart.error}</p> : null}
      </Card>
      <Card>
        <CardHeader title={t("updates")} description={updateMessage(updater.phase, updater.info?.version, t)} />
        {updater.phase === "downloading" ? (
          <progress max={100} value={updater.progress.percent ?? undefined} />
        ) : null}
        <div className="button-row">
          <Button variant="secondary" disabled={updater.phase === "checking" || updater.phase === "disabled"} onClick={() => void updater.checkForUpdate()}>
            {t("checkUpdates")}
          </Button>
          {updater.phase === "available" ? <Button onClick={() => void updater.downloadAndInstall()}>{t("installUpdate")}</Button> : null}
          {updater.phase === "ready" ? <Button onClick={() => void updater.restart()}>{t("restart")}</Button> : null}
        </div>
        {updater.error ? <p role="alert" className="error">{updater.error}</p> : null}
      </Card>
    </div>
  );
}
