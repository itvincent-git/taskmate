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
    const onChange = vi.fn();
    render(<DynamicFilter definition={base} current={[]} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Due condition"), "range");
    await userEvent.setup().type(screen.getByLabelText("Filter by Due"), "2026-07-01");
    await userEvent.setup().type(screen.getByLabelText("Due range end"), "2026-07-31");
    expect(onChange).toHaveBeenLastCalledWith([
      { key: "due", operator: "gte", value: "2026-07-01" },
      { key: "due", operator: "lte", value: "2026-07-31" },
    ]);
  });
});
