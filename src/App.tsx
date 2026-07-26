import { lazy, Suspense, useCallback, useState } from "react";
import { Home, ScrollText, Settings } from "lucide-react";
import { HomePage } from "./components/HomePage";
import { SettingsPage } from "./components/SettingsPage";
import { usePreferences } from "./hooks/usePreferences";
import { translate, type MessageKey } from "./lib/i18n";
import type { AppView } from "./types";
import packageJson from "../package.json";

const LogsPage = lazy(() => import("./components/LogsPage").then((module) => ({ default: module.LogsPage })));

export function App() {
  const [view, setView] = useState<AppView>("home");
  const { language, setLanguage } = usePreferences();
  const t = useCallback((key: MessageKey, values?: Record<string, string>) => translate(language, key, values), [language]);
  const navigation = [
    { id: "home" as const, label: t("home"), icon: Home },
    { id: "settings" as const, label: t("settings"), icon: Settings },
    { id: "logs" as const, label: t("logs"), icon: ScrollText },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>T</span><strong>{t("appName")}</strong></div>
        <nav aria-label="Primary">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
              <Icon aria-hidden /><span>{label}</span>
            </button>
          ))}
        </nav>
        <p className="version">v{packageJson.version}</p>
      </aside>
      <main>
        <header className="page-header"><h1>{t(view)}</h1></header>
        <div className="page-content">
          {view === "home" ? <HomePage t={t} /> : null}
          {view === "settings" ? <SettingsPage language={language} setLanguage={setLanguage} t={t} /> : null}
          {view === "logs" ? <Suspense fallback={<p className="muted">…</p>}><LogsPage t={t} /></Suspense> : null}
        </div>
      </main>
    </div>
  );
}
