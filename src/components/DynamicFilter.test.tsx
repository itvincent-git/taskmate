import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PropertyDefinition } from "../types";
import { DynamicFilter } from "./DynamicFilter";

const base: PropertyDefinition = {
  id: "due",
  key: "due",
  name: "Due",
  type: "date",
  showInDetail: true,
  showInCard: true,
  enableFilter: true,
  enableSort: true,
  options: [],
  order: 0,
};

describe("DynamicFilter", () => {
  it("builds typed range conditions for date and number fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DynamicFilter definition={base} current={[]} onChange={onChange} />);
    await user.click(screen.getByLabelText("Due match"));
    await user.click(await screen.findByRole("option", { name: "Due: Range" }));
    await user.type(screen.getByLabelText("Due Filter"), "2026-07-01");
    await user.type(screen.getByLabelText("Due Range"), "2026-07-31");
    expect(onChange).toHaveBeenLastCalledWith([
      { key: "due", operator: "gte", value: "2026-07-01" },
      { key: "due", operator: "lte", value: "2026-07-31" },
    ]);
  });

  it("supports Any and All matching with multiple selected options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DynamicFilter definition={{ ...base, type: "tags", name: "Tags", key: "tags", options: [{ id: "rust", label: "Rust", order: 0 }, { id: "tauri", label: "Tauri", order: 1 }] }} current={[]} onChange={onChange} />);
    await user.click(screen.getByLabelText("Tags Filter"));
    await user.click(await screen.findByRole("checkbox", { name: "Rust" }));
    await user.click(screen.getByRole("checkbox", { name: "Tauri" }));
    expect(onChange).toHaveBeenLastCalledWith([{ key: "tags", operator: "any", value: ["rust", "tauri"] }]);
    await user.click(screen.getByLabelText("Tags match"));
    await user.click(await screen.findByRole("option", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith([{ key: "tags", operator: "all", value: ["rust", "tauri"] }]);
  });
});
