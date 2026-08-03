import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  restart: vi.fn(),
  updater: {
    phase: "available",
    info: {
      version: "0.7.0",
      currentVersion: "0.6.1",
      body: JSON.stringify({ en: "- Added update details", zh: "- 新增升级内容" }),
      date: "2026-08-02T00:00:00Z",
    } as { version: string; currentVersion: string; body: string; date: string } | null,
    progress: { downloaded: 0, total: null as number | null, percent: null as number | null },
    error: null as string | null,
  },
}));

vi.mock("./hooks/useUpdater", () => ({
  useUpdater: () => ({
    ...mocks.updater,
    checkForUpdate: mocks.checkForUpdate,
    downloadAndInstall: mocks.downloadAndInstall,
    restart: mocks.restart,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("taskmate.locale.v1", "en");
  window.location.hash = "#/";
  mocks.checkForUpdate.mockReset();
  mocks.downloadAndInstall.mockReset();
  mocks.restart.mockReset();
  mocks.updater.phase = "available";
  mocks.updater.info = {
    version: "0.7.0",
    currentVersion: "0.6.1",
    body: JSON.stringify({ en: "- Added update details", zh: "- 新增升级内容" }),
    date: "2026-08-02T00:00:00Z",
  };
  mocks.updater.progress = { downloaded: 0, total: null, percent: null };
  mocks.updater.error = null;
});

async function openWorkspace() {
  await userEvent.click(screen.getByRole("button", { name: "Open workspace" }));
}

it("shows an available update in the sidebar without opening a dialog", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Open workspace" }));

  expect(screen.queryByRole("heading", { name: "Update available" })).not.toBeInTheDocument();
  const updateButton = screen.getByRole("button", { name: "Download Taskmate 0.7.0" });
  const switchButton = screen.getByRole("button", { name: "Switch workspace" });
  expect(updateButton.compareDocumentPosition(switchButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(updateButton);
  expect(mocks.downloadAndInstall).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("link", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "What's new" })).toBeInTheDocument();
  expect(screen.getByText("- Added update details")).toBeInTheDocument();
});

it("shows determinate and indeterminate download progress and prevents repeat clicks", async () => {
  mocks.updater.phase = "downloading";
  mocks.updater.progress = { downloaded: 42, total: 100, percent: 42 };
  const { rerender } = render(<App />);
  await openWorkspace();

  const progressButton = screen.getByRole("button", { name: "Downloading update: 42%" });
  expect(progressButton).toBeDisabled();
  expect(progressButton).toHaveTextContent("42%");
  await userEvent.click(progressButton);
  expect(mocks.downloadAndInstall).not.toHaveBeenCalled();

  mocks.updater.progress = { downloaded: 42, total: null, percent: null };
  rerender(<App />);
  const indeterminateButton = screen.getByRole("button", { name: "Downloading update…" });
  expect(indeterminateButton).toBeDisabled();
  expect(indeterminateButton.querySelector(".animate-spin")).not.toBeNull();
});

it("restarts a ready update and retries a failed download", async () => {
  const user = userEvent.setup();
  mocks.updater.phase = "ready";
  const { rerender } = render(<App />);
  await user.click(screen.getByRole("button", { name: "Open workspace" }));

  await user.click(screen.getByRole("button", { name: "Restart to update" }));
  expect(mocks.restart).toHaveBeenCalledTimes(1);

  mocks.updater.phase = "error";
  mocks.updater.error = "download failed";
  rerender(<App />);
  await user.click(screen.getByRole("button", { name: "Download Taskmate 0.7.0 again" }));
  expect(mocks.downloadAndInstall).toHaveBeenCalledTimes(1);
});

it("does not show a sidebar update action when a check fails without version information", async () => {
  mocks.updater.phase = "error";
  mocks.updater.info = null;
  mocks.updater.error = "offline";
  render(<App />);
  await openWorkspace();

  expect(screen.queryByRole("button", { name: /download|update|restart/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch workspace" })).toBeInTheDocument();
});

it("localizes the sidebar update actions in Chinese", async () => {
  localStorage.setItem("taskmate.locale.v1", "zh-CN");
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "打开工作区" }));

  expect(screen.getByRole("button", { name: "下载 Taskmate 0.7.0" })).toBeInTheDocument();
});
