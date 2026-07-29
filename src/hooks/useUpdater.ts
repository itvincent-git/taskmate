import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
  const updateRef = useRef<Update | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>(() => canUpdate() ? "idle" : "disabled");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null, percent: null });
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!canUpdate()) {
      setPhase("disabled");
      return;
    }
    setPhase("checking");
    setError(null);
    try {
      const [currentVersion, update] = await Promise.all([getVersion(), check()]);
      updateRef.current = update;
      if (!update) {
        setInfo(null);
        setPhase("current");
        return;
      }
      setInfo({ version: update.version, currentVersion, body: update.body, date: update.date });
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
    const update = updateRef.current;
    if (!update) return;
    setPhase("downloading");
    setError(null);
    let downloaded = 0;
    let total: number | null = null;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        setProgress({
          downloaded,
          total,
          percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
        });
      });
      setPhase("ready");
    } catch (reason) {
      setError(String(reason));
      setPhase("error");
    }
  }, []);

  const restart = useCallback(async () => {
    setPhase("restarting");
    try {
      await relaunch();
    } catch (reason) {
      setError(String(reason));
      setPhase("error");
    }
  }, []);

  return { phase, info, progress, error, checkForUpdate, downloadAndInstall, restart };
}
