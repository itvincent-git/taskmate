import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { FONT_SETTINGS_STORAGE_KEY, getFontSettings, setFont } from "../lib/font-settings";
import { TaskmateI18nProvider } from "../lib/taskmate-i18n";
import { FontSettings } from "./FontSettings";

beforeEach(() => {
  vi.restoreAllMocks();
  setFont("interface", null);
  setFont("editor", null);
});

describe("FontSettings", () => {
  it("chooses and persists interface and editor fonts independently", async () => {
    const user = userEvent.setup();
    const picker = vi.spyOn(api, "pickSystemFont")
      .mockResolvedValueOnce("Avenir Next")
      .mockResolvedValueOnce("JetBrains Mono");
    renderSettings();

    const choose = screen.getAllByRole("button", { name: "Choose font" });
    await user.click(choose[0]);
    await user.click(choose[1]);

    expect(picker).toHaveBeenNthCalledWith(1, null, "Interface font", "Select a font family");
    expect(picker).toHaveBeenNthCalledWith(2, null, "Editor font", "Select a font family");
    expect(getFontSettings()).toEqual({ interface: "Avenir Next", editor: "JetBrains Mono" });
    expect(JSON.parse(localStorage.getItem(FONT_SETTINGS_STORAGE_KEY)!)).toEqual({ interface: "Avenir Next", editor: "JetBrains Mono" });
    expect(document.documentElement.style.getPropertyValue("--font-interface-custom")).toBe('"Avenir Next"');
    expect(document.documentElement.style.getPropertyValue("--font-editor-custom")).toBe('"JetBrains Mono"');
  });

  it("keeps the current font when the system picker is cancelled and can reset a choice", async () => {
    const user = userEvent.setup();
    setFont("interface", "Helvetica Neue");
    vi.spyOn(api, "pickSystemFont").mockResolvedValue(null);
    renderSettings();

    await user.click(screen.getAllByRole("button", { name: "Choose font" })[0]);
    expect(getFontSettings().interface).toBe("Helvetica Neue");

    await user.click(screen.getAllByRole("button", { name: "Reset" })[0]);
    expect(getFontSettings().interface).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--font-interface-custom")).toBe("");
  });

  it("shows localized font settings", () => {
    localStorage.setItem("taskmate.locale.v1", "zh-CN");
    renderSettings();

    expect(screen.getByRole("heading", { name: "字体" })).toBeInTheDocument();
    expect(screen.getByText("界面字体")).toBeInTheDocument();
    expect(screen.getByText("编辑器字体")).toBeInTheDocument();
  });
});

function renderSettings() {
  return render(<TaskmateI18nProvider><FontSettings /></TaskmateI18nProvider>);
}
