import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UpdateInfo, UpdatePhase, UpdateProgress } from "../types";

let startupCheckScheduled = false;

function canUpdate() {
  const testing = (globalThis as typeof globalThis & { __TEST_UPDATER__?: boolean }).__TEST_UPDATER__ === true;
  return testing || (!import.meta.env.DEV && "__TAURI_INTERNALS__" in window);
}

function canCheckOnStartup() {
  return !import.meta.env.DEV && "__TAURI_INTERNALS__" in window;
}

export function useUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>(() => canUpdate() ? "idle" : "disabled");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null, percent: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canUpdate()) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listen<{ downloaded: number; total: number | null; finished: boolean }>("update-download-progress", ({ payload }) => {
      if (!mounted) return;
      const total = payload.total && payload.total > 0 ? payload.total : null;
      setProgress({
        downloaded: payload.downloaded,
        total,
        percent: total ? Math.min(100, Math.round((payload.downloaded / total) * 100)) : null,
      });
    }).then((cleanup) => {
      if (mounted) unlisten = cleanup;
      else cleanup();
    }).catch((reason) => console.warn("Unable to listen for update progress", reason));
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!canUpdate()) {
      setPhase("disabled");
      return;
    }
    setPhase("checking");
    setError(null);
    try {
      const update = await invoke<UpdateInfo | null>("check_for_updates");
      if (!update) {
        setInfo(null);
        setPhase("current");
        return;
      }
      setInfo(update);
      setPhase("available");
    } catch (reason) {
      setError(String(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!canCheckOnStartup() || startupCheckScheduled) return;
    startupCheckScheduled = true;
    const timeout = window.setTimeout(() => void checkForUpdate(), 1500);
    return () => window.clearTimeout(timeout);
  }, [checkForUpdate]);

  const downloadAndInstall = useCallback(async () => {
    if (!info) return;
    setPhase("downloading");
    setError(null);
    setProgress({ downloaded: 0, total: null, percent: null });
    try {
      await invoke<string>("download_and_install_update");
      setPhase("ready");
    } catch (reason) {
      setError(String(reason));
      setPhase("error");
    }
  }, [info]);

  const restart = useCallback(async () => {
    setPhase("restarting");
    try {
      await invoke("restart_app");
    } catch (reason) {
      setError(String(reason));
      setPhase("error");
    }
  }, []);

  return { phase, info, progress, error, checkForUpdate, downloadAndInstall, restart };
}
