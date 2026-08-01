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
  it("allows selecting an existing option or entering a custom value", () => {
    const onChange = vi.fn();
    render(<PropertyInput definition={{
      ...base,
      type: "select",
      options: [
        { id: "work", label: "Work", order: 1 },
        { id: "personal", label: "Personal", order: 0 },
      ],
    }} value="work" onChange={onChange} />);

    const input = screen.getByLabelText("Field");
    expect(input).toHaveValue("Work");
    expect(input).toHaveAttribute("list");
    const optionList = document.getElementById(input.getAttribute("list")!);
    expect(Array.from(optionList!.querySelectorAll("option"), (option) => option.value)).toEqual(["Personal", "Work"]);

    fireEvent.change(input, { target: { value: "Personal" } });
    expect(onChange).toHaveBeenLastCalledWith("personal");
    fireEvent.change(input, { target: { value: "Errands" } });
    expect(onChange).toHaveBeenLastCalledWith("Errands");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
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
