import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  progressListener: undefined as ((event: { payload: { downloaded: number; total: number | null; finished: boolean } }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

beforeAll(() => {
  (globalThis as typeof globalThis & { __TEST_UPDATER__?: boolean }).__TEST_UPDATER__ = true;
});

beforeEach(() => {
  mocks.progressListener = undefined;
  mocks.listen.mockImplementation(async (_event, listener) => {
    mocks.progressListener = listener;
    return vi.fn();
  });
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "check_for_updates") {
      return { version: "0.2.0", currentVersion: "0.1.0", body: "Changes", date: "2026-01-01" };
    }
    if (command === "download_and_install_update") {
      mocks.progressListener?.({ payload: { downloaded: 40, total: 100, finished: false } });
      mocks.progressListener?.({ payload: { downloaded: 100, total: 100, finished: true } });
      return "0.2.0";
    }
    if (command === "restart_app") return undefined;
    throw new Error(`Unexpected command: ${command}`);
  });
});

it("checks, reports progress, installs, and restarts an update", async () => {
  const { useUpdater } = await import("./useUpdater");
  const { result } = renderHook(() => useUpdater());
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("available");
  expect(result.current.info?.version).toBe("0.2.0");
  await act(() => result.current.downloadAndInstall());
  expect(result.current.phase).toBe("ready");
  expect(result.current.progress.percent).toBe(100);
  await act(() => result.current.restart());
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("restart_app"));
});

it("reports when no update is available", async () => {
  mocks.invoke.mockResolvedValue(null);
  const { useUpdater } = await import("./useUpdater");
  const { result } = renderHook(() => useUpdater());
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("current");
  expect(result.current.info).toBeNull();
});

it("allows a failed update check to be retried", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
  const { useUpdater } = await import("./useUpdater");
  const { result } = renderHook(() => useUpdater());
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("error");
  expect(result.current.error).toContain("offline");
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("current");
});

it("keeps update information when a download fails so it can be retried", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "check_for_updates") return { version: "0.2.0", currentVersion: "0.1.0", body: "Changes", date: "2026-01-01" };
    if (command === "download_and_install_update") throw new Error("download failed");
    throw new Error(`Unexpected command: ${command}`);
  });
  const { useUpdater } = await import("./useUpdater");
  const { result } = renderHook(() => useUpdater());
  await act(() => result.current.checkForUpdate());
  await act(() => result.current.downloadAndInstall());
  expect(result.current.phase).toBe("error");
  expect(result.current.info?.version).toBe("0.2.0");
  expect(result.current.error).toContain("download failed");
  await act(() => result.current.downloadAndInstall());
  expect(mocks.invoke).toHaveBeenCalledWith("download_and_install_update");
  expect(mocks.invoke).toHaveBeenCalledTimes(3);
});
