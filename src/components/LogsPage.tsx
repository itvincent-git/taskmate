import { useEffect, useRef, useState } from "react";
import { attachLogger, LogLevel } from "@tauri-apps/plugin-log";
import { Trash2 } from "lucide-react";
import type { MessageKey } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Card, CardHeader } from "./ui/Card";

interface Entry {
  id: number;
  level: LogLevel;
  message: string;
  timestamp: number;
}

const levelNames: Record<LogLevel, string> = {
  [LogLevel.Trace]: "TRACE",
  [LogLevel.Debug]: "DEBUG",
  [LogLevel.Info]: "INFO",
  [LogLevel.Warn]: "WARN",
  [LogLevel.Error]: "ERROR",
};

export function LogsPage({ t }: { t: (key: MessageKey) => string }) {
  const [logs, setLogs] = useState<Entry[]>([]);
  const nextId = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    void attachLogger((record) => {
      if (!active) return;
      setLogs((current) => [...current, { ...record, id: nextId.current++, timestamp: Date.now() }].slice(-1000));
    }).then((unlisten) => {
      if (active) detach = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      detach?.();
    };
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logs]);

  return (
    <Card className="log-card">
      <div className="setting-row">
        <CardHeader title={t("diagnostics")} />
        <Button variant="secondary" onClick={() => setLogs([])}><Trash2 aria-hidden />{t("clear")}</Button>
      </div>
      <div className="log-viewport" ref={viewport}>
        {logs.length === 0 ? <p className="muted">{t("waiting")}</p> : logs.map((entry) => (
          <div className="log-line" key={entry.id}>
            <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
            <strong data-level={levelNames[entry.level]}>{levelNames[entry.level]}</strong>
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
