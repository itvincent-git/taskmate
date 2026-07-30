import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("shared control font sizes", () => {
  it("uses the 12px text size for controls and menu items", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>Save</Button>
        <Input aria-label="Title" />
        <Textarea aria-label="Notes" />
        <Select
          ariaLabel="Status"
          value="todo"
          onValueChange={vi.fn()}
          options={[{ value: "todo", label: "To do" }, { value: "done", label: "Done" }]}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("text-xs");
    expect(screen.getByLabelText("Title")).toHaveClass("text-xs");
    expect(screen.getByLabelText("Notes")).toHaveClass("text-xs");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveClass("text-xs");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(await screen.findByRole("option", { name: "Done" })).toHaveClass("text-xs");
  });
});
