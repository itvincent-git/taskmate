import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  unlistenLog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: mocks.isEnabled,
  enable: mocks.enable,
  disable: mocks.disable,
}));
vi.mock("@tauri-apps/plugin-log", () => ({
  LogLevel: { Trace: 1, Debug: 2, Info: 3, Warn: 4, Error: 5 },
  attachLogger: vi.fn(async () => mocks.unlistenLog),
}));

describe("application shell", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    mocks.isEnabled.mockResolvedValue(false);
    mocks.enable.mockResolvedValue(undefined);
    mocks.disable.mockResolvedValue(undefined);
  });

  it("navigates between the three views and persists language", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("Your desktop foundation is ready.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Language"), "zh");
    expect(screen.getByRole("button", { name: "首页" })).toBeInTheDocument();
    expect(localStorage.getItem("your-app.preferences.v1")).toContain('"zh"');
    await user.click(screen.getByRole("button", { name: "日志" }));
    expect(await screen.findByText("诊断日志")).toBeInTheDocument();
  });

  it("shows successful and failed Rust IPC results", async () => {
    const user = userEvent.setup();
    mocks.invoke.mockResolvedValueOnce("Hello, Ada!");
    render(<App />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Send greeting" }));
    expect(await screen.findByText("Hello, Ada!")).toBeInTheDocument();
    mocks.invoke.mockRejectedValueOnce("backend unavailable");
    await user.click(screen.getByRole("button", { name: "Send greeting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("backend unavailable");
  });

  it("rolls autostart state back when enabling fails", async () => {
    const user = userEvent.setup();
    mocks.enable.mockRejectedValueOnce(new Error("permission denied"));
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("checkbox", { name: "Launch at login" });
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
  });
});
