import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LogsPage } from "./LogsPage";
import { translate } from "../lib/i18n";

const logger = vi.hoisted(() => ({ callback: undefined as ((record: Record<string, unknown>) => void) | undefined, unlisten: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({
  LogLevel: { Trace: 1, Debug: 2, Info: 3, Warn: 4, Error: 5 },
  attachLogger: vi.fn(async (callback) => {
    logger.callback = callback;
    return logger.unlisten;
  }),
}));

afterEach(() => {
  logger.callback = undefined;
  logger.unlisten.mockClear();
});

it("caps logs at 1000 entries and removes the listener", async () => {
  const { unmount } = render(<LogsPage t={(key) => translate("en", key)} />);
  await waitFor(() => expect(logger.callback).toBeTypeOf("function"));
  for (let index = 0; index < 1005; index += 1) {
    logger.callback?.({ level: 3, message: `entry-${index}` });
  }
  expect(await screen.findByText("entry-1004")).toBeInTheDocument();
  expect(screen.queryByText("entry-0")).not.toBeInTheDocument();
  unmount();
  expect(logger.unlisten).toHaveBeenCalledOnce();
});
