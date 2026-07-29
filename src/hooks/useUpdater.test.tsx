import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  relaunch: vi.fn(),
  downloadAndInstall: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

beforeAll(() => {
  (globalThis as typeof globalThis & { __TEST_UPDATER__?: boolean }).__TEST_UPDATER__ = true;
});

beforeEach(() => {
  mocks.getVersion.mockResolvedValue("0.1.0");
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.downloadAndInstall.mockImplementation(async (callback: (event: unknown) => void) => {
    callback({ event: "Started", data: { contentLength: 100 } });
    callback({ event: "Progress", data: { chunkLength: 40 } });
    callback({ event: "Progress", data: { chunkLength: 60 } });
    callback({ event: "Finished" });
  });
  mocks.check.mockResolvedValue({
    version: "0.2.0",
    currentVersion: "0.1.0",
    body: "Changes",
    date: "2026-01-01",
    downloadAndInstall: mocks.downloadAndInstall,
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
  await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledOnce());
});

it("reports when no update is available", async () => {
  mocks.check.mockResolvedValue(null);
  const { useUpdater } = await import("./useUpdater");
  const { result } = renderHook(() => useUpdater());
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("current");
  expect(result.current.info).toBeNull();
});

it("allows a failed update check to be retried", async () => {
  mocks.check.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
  const { useUpdater } = await import("./useUpdater");
  const { result } = renderHook(() => useUpdater());
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("error");
  expect(result.current.error).toContain("offline");
  await act(() => result.current.checkForUpdate());
  expect(result.current.phase).toBe("current");
});
