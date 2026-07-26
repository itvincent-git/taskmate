import { useCallback, useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export function useAutostart() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    isEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      await (next ? enable() : disable());
    } catch (reason) {
      setEnabled(previous);
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, [enabled]);

  return { enabled, busy, error, toggle };
}
