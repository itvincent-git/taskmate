import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition } from "../types";
import { PropertyInput } from "./PropertyInput";

const base: PropertyDefinition = {
  id: "field",
  key: "field",
  name: "Field",
  type: "text",
  showInDetail: true,
  showInCard: true,
  enableFilter: true,
  enableSort: true,
  options: [],
  order: 0,
};

describe("PropertyInput", () => {
  it("keeps select values limited to existing options and not set", async () => {
    const onChange = vi.fn();
    render(<PropertyInput definition={{
      ...base,
      type: "select",
      options: [
        { id: "work", label: "Work", order: 1 },
        { id: "personal", label: "Personal", order: 0 },
      ],
    }} value="work" onChange={onChange} />);

    const user = userEvent.setup();
    expect(screen.queryByRole("textbox", { name: "Field" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Field" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Not set", "Personal", "Work"]);
    await user.click(screen.getByRole("option", { name: "Personal" }));
    expect(onChange).toHaveBeenLastCalledWith("personal");
    await user.click(screen.getByRole("combobox", { name: "Field" }));
    await user.click(screen.getByRole("option", { name: "Not set" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("searches, toggles, creates, and preserves legacy tag values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCreateOption = vi.fn(async (label: string) => ({ id: label, label, color: "#9C9C9C", order: 2 }));
    render(<PropertyInput definition={{ ...base, type: "tags", options: [{ id: "rust", label: "Rust", order: 0 }, { id: "tauri", label: "Tauri", order: 1 }] }} value={["rust", "legacy"]} onChange={onChange} onCreateOption={onCreateOption} />);

    expect(screen.getByText("legacy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove legacy" }));
    expect(onChange).toHaveBeenLastCalledWith(["rust"]);

    const input = screen.getByRole("textbox", { name: "Field" });
    await user.type(input, "TAU");
    expect(screen.getByRole("option", { name: "Tauri" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Rust" })).not.toBeInTheDocument();
    await user.type(input, "RI");
    await user.keyboard("{Enter}");
    expect(onCreateOption).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(["rust", "legacy", "tauri"]);

    await user.type(input, "  Release, 1  {Enter}");
    expect(onCreateOption).toHaveBeenCalledWith("Release, 1");
    expect(onChange).toHaveBeenLastCalledWith(["rust", "legacy", "Release, 1"]);
  });

  it("rejects blank tag creation and retains input when creation fails", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCreateOption = vi.fn().mockRejectedValue(new Error("persist failed"));
    render(<PropertyInput definition={{ ...base, type: "tags" }} value={[]} onChange={onChange} onCreateOption={onCreateOption} />);
    const input = screen.getByRole("textbox", { name: "Field" });
    await user.type(input, "   {Enter}");
    expect(onCreateOption).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "Blocked{Enter}");
    expect(onCreateOption).toHaveBeenCalledWith("Blocked");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("Blocked");
  });

  it("does not show an empty tag dropdown before any tags exist", async () => {
    const user = userEvent.setup();
    render(<PropertyInput definition={{ ...base, type: "tags" }} value={[]} onChange={vi.fn()} onCreateOption={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "Field" });
    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(input, "First tag");
    expect(screen.getByRole("listbox")).toHaveTextContent("First tag");
  });

  it("uses typed controls and returns typed values", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<PropertyInput definition={{ ...base, type: "number" }} value={3} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);

    rerender(<PropertyInput definition={{ ...base, type: "boolean" }} value={false} onChange={onChange} />);
    await userEvent.setup().click(screen.getByLabelText("Field"));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});
