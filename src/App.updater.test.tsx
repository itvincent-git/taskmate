import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./hooks/useUpdater", () => ({
  useUpdater: () => ({
    phase: "available" as const,
    info: {
      version: "0.7.0",
      currentVersion: "0.6.1",
      body: JSON.stringify({ en: "- Added update details", zh: "- 新增升级内容" }),
      date: "2026-08-02T00:00:00Z",
    },
    progress: { downloaded: 0, total: null, percent: null },
    error: null,
    checkForUpdate: vi.fn(),
    downloadAndInstall: vi.fn(),
    restart: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/";
});

it("shows localized release notes in the update dialog and settings", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Open workspace" }));

  expect(await screen.findByRole("heading", { name: "Update available" })).toBeInTheDocument();
  expect(screen.getByText("- Added update details")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Later" }));
  await user.click(screen.getByRole("link", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "What's new" })).toBeInTheDocument();
  expect(screen.getByText("- Added update details")).toBeInTheDocument();
});
