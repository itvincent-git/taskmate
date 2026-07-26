import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Code2, Laptop, Rocket } from "lucide-react";
import type { MessageKey } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Card, CardHeader } from "./ui/Card";

export function HomePage({ t }: { t: (key: MessageKey) => string }) {
  const [name, setName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function greet(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await invoke<string>("greet", { name }));
    } catch (reason) {
      const message = String(reason);
      setError(message.includes("__TAURI__") ? t("noTauri") : message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <Card className="hero">
        <div className="hero-icon"><Rocket aria-hidden /></div>
        <div>
          <p className="eyebrow">TAURI DESKTOP TEMPLATE</p>
          <h1>{t("templateReady")}</h1>
          <p>{t("templateHint")}</p>
        </div>
      </Card>
      <div className="grid-two">
        <Card>
          <CardHeader title={t("environment")} description={t("environmentText")} />
          <div className="feature-row"><Laptop aria-hidden /><span>macOS · Windows</span></div>
        </Card>
        <Card>
          <CardHeader title={t("ipcTitle")} />
          <form className="greet-form" onSubmit={greet}>
            <label htmlFor="greet-name">{t("name")}</label>
            <div className="field-row">
              <input
                id="greet-name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder={t("greetingPlaceholder")}
              />
              <Button disabled={busy} type="submit"><Code2 aria-hidden />{t("greet")}</Button>
            </div>
            {result ? <output className="success">{result}</output> : null}
            {error ? <p role="alert" className="error">{error}</p> : null}
          </form>
        </Card>
      </div>
    </div>
  );
}
